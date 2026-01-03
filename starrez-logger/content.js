// StarRez Package Logger - Content Script

// Extract staff name from Pendo script
function getStaffName() {
    const scripts = document.querySelectorAll('script');
    for (let script of scripts) {
        const scriptText = script.textContent;
        if (scriptText.includes('pendo.initialize') && scriptText.includes('full_name')) {
            const fullNameMatch = scriptText.match(/full_name:\s*`([^`]+)`/);
            if (fullNameMatch && fullNameMatch[1]) {
                return fullNameMatch[1];
            }
        }
    }
    return null;
}

// Extract student data from Rez 360 detail view
function getStudentDataFromRez360() {
    const data = {};
    
    // Find the active detail container to ensure we don't pull data from other loaded profiles
    const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;

    // Get student name from breadcrumb (most reliable)
    const breadcrumbs = detailContainer.querySelectorAll('habitat-header-breadcrumb-item');
    for (let crumb of breadcrumbs) {
        const text = crumb.textContent.trim();
        // Must have comma, not be a navigation item
        if (text.includes(',') && !text.includes('Dashboard') && !text.includes('Desk') && !text.includes('Front')) {
            data.fullName = text;
            break;
        }
    }
    
    // Get student number from within the container
    const containerText = detailContainer.innerText;
    const studentNumMatch = containerText.match(/Student Number\s+(\d{8})/);
    if (studentNumMatch) {
        data.studentNumber = studentNumMatch[1];
    }
    
    // FIXED: Narrower room regex to prioritize Building-Room format (e.g., CMH-05213)
    // Looks specifically for text following the "Room" label
    const roomMatch = containerText.match(/Room\s+([A-Z]{3,4}-[\d\w]+)/i);
    if (roomMatch) {
        let roomString = roomMatch[1];
        // If there's a slash (e.g. CMH-05213/CMH-05213b), take the first part
        if (roomString.includes('/')) {
            roomString = roomString.split('/')[0];
        }
        data.roomSpace = roomString;
    }
    
    return Object.keys(data).length > 0 ? data : null;
}

// Get initials from full name in format: FirstInitials.LastInitials
function getInitials(fullName) {
    if (fullName.includes(',')) {
        const parts = fullName.split(',').map(p => p.trim());
        const lastName = parts[0];
        const firstName = parts[1] || '';
        
        // Get all initials from first name(s) and all initials from last name(s)
        const firstInitials = firstName.split(' ').filter(n => n.length > 0).map(n => n[0]).join('');
        const lastInitials = lastName.split(' ').filter(n => n.length > 0).map(n => n[0]).join('');
        
        return `${firstInitials}.${lastInitials}`.toUpperCase();
    }
    
    // Fallback for names without commas
    const nameParts = fullName.split(' ').filter(p => p.length > 0);
    if (nameParts.length > 1) {
        const last = nameParts.pop();
        const firsts = nameParts.map(n => n[0]).join('');
        return `${firsts}.${last[0]}`.toUpperCase();
    }
    return nameParts.map(part => part[0]).join('').toUpperCase();
}

// Format current time
function getCurrentTime() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutesStr} ${ampm}`;
}

// Generate log entry with custom package count
function generateLogEntry(packageCount = 1) {
    try {
        const staffName = getStaffName();
        // Force the dot format for staff initials specifically
        const staffInitialsRaw = staffName ? getInitials(staffName) : 'X.X';
        const staffInitials = staffInitialsRaw.replace('.', ''); // Plain AB format
        
        const studentData = getStudentDataFromRez360();
        
        if (!studentData || !studentData.fullName) {
            return { success: false, error: 'Could not find student name' };
        }
        
        if (!studentData.studentNumber) {
            return { success: false, error: 'Could not find student number' };
        }
        
        if (!studentData.roomSpace) {
            return { success: false, error: 'Could not find room/bed space' };
        }
        
        const initials = getInitials(studentData.fullName);
        const time = getCurrentTime();
        
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} ${packageCount} pkg${packageCount > 1 ? 's' : ''} @ ${time} - ${staffInitials}`;
        
        return {
            success: true,
            logEntry: logEntry,
            data: {
                initials,
                studentNumber: studentData.studentNumber,
                roomSpace: studentData.roomSpace,
                packageCount,
                time,
                fullName: studentData.fullName,
                staffInitials,
                staffName
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Copy to clipboard
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        return false;
    }
}

// Create button helper
function createStyledButton(text, gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)') {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.cssText = `
        margin-left: 10px;
        padding: 8px 16px;
        background: ${gradient};
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        transition: all 0.2s ease;
    `;
    
    button.addEventListener('mouseenter', () => {
        button.style.transform = 'translateY(-2px)';
        button.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
    });
    
    button.addEventListener('mouseleave', () => {
        button.style.transform = 'translateY(0)';
        button.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)';
    });
    
    return button;
}

// Find the "X Parcels" span element
function findParcelCountElement() {
    const spans = Array.from(document.querySelectorAll('span'));
    for (let span of spans) {
        const text = span.textContent.trim();
        if (/^\d+\s+Parcel[s]?$/i.test(text) && span.children.length === 0) {
            return span;
        }
    }
    return null;
}

// FIXED: Create buttons for multiple packages
function createLogButtons() {
    // RESTRICTION: Only run inside a container that looks like the Parcels section
    const parcelSection = Array.from(document.querySelectorAll('section, div')).find(el => {
        const header = el.querySelector('h1, h2, h3, .ui-widget-header');
        return header && header.textContent.includes('Parcels');
    });

    if (!parcelSection) return;

    // Find all Issue buttons ONLY in the parcel section
    const issueButtons = Array.from(parcelSection.querySelectorAll('button, input[type=\"button\"], a.button, a[class*=\"button\"]')).filter(btn => {
        const text = btn.textContent.toLowerCase();
        return text.includes('issue') && !text.includes('reissue');
    });
    
    if (issueButtons.length === 0) {
        return;
    }
    
    const packageCount = issueButtons.length;
    
    // Add master button next to \"X Parcels\" text
    if (packageCount >= 2) {
        const parcelCountElement = findParcelCountElement();
        
        if (parcelCountElement && !document.getElementById('package-log-master-btn')) {
            const masterButton = createStyledButton(
                `Copy ${packageCount} pkgs`,
                'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
            );
            masterButton.id = 'package-log-master-btn';
            masterButton.style.marginLeft = '15px';
            masterButton.style.verticalAlign = 'middle';
            
            masterButton.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const result = generateLogEntry(packageCount);
                
                if (result.success) {
                    const copied = await copyToClipboard(result.logEntry);
                    
                    if (copied) {
                        const originalText = masterButton.textContent;
                        masterButton.textContent = 'Copied!';
                        masterButton.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
                        
                        showPreview(result.logEntry, result.data);
                        
                        setTimeout(() => {
                            masterButton.textContent = originalText;
                            masterButton.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
                        }, 2000);
                    }
                } else {
                    alert('Error: ' + result.error);
                }
            });
            
            parcelCountElement.parentNode.insertBefore(masterButton, parcelCountElement.nextSibling);
        }
    }
    
    // Add individual \"Copy Log\" buttons
    issueButtons.forEach((issueBtn, index) => {
        const buttonId = `package-log-btn-${index}`;
        
        if (document.getElementById(buttonId)) {
            return;
        }
        
        const logButton = createStyledButton('Copy Log');
        logButton.id = buttonId;
        
        logButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const result = generateLogEntry(1);
            
            if (result.success) {
                const copied = await copyToClipboard(result.logEntry);
                
                if (copied) {
                    const originalText = logButton.textContent;
                    logButton.textContent = 'Copied!';
                    logButton.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
                    
                    showPreview(result.logEntry, result.data);
                    
                    setTimeout(() => {
                        logButton.textContent = originalText;
                        logButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                    }, 2000);
                }
            } else {
                alert('Error: ' + result.error);
            }
        });
        
        issueBtn.parentNode.insertBefore(logButton, issueBtn.nextSibling);
    });
}

// Show preview
function showPreview(text, data) {
    const existing = document.getElementById('log-preview-popup');
    if (existing) existing.remove();
    
    const preview = document.createElement('div');
    preview.id = 'log-preview-popup';
    preview.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        border: 2px solid #667eea;
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        z-index: 10000;
        max-width: 400px;
        font-family: monospace;
        font-size: 13px;
        animation: slideIn 0.3s ease;
    `;
    
    const staffInfo = data.staffName ? `<div style=\"font-size: 11px; color: #999; margin-bottom: 4px;\">Logged by: ${data.staffName}</div>` : '';
    const debugInfo = `<div style=\"font-size: 10px; color: #ccc; margin-top: 8px;\">Student: ${data.fullName} | Room: ${data.roomSpace}</div>`;
    
    preview.innerHTML = `
        <div style=\"font-weight: bold; margin-bottom: 8px; color: #667eea;\">Copied to Clipboard:</div>
        ${staffInfo}
        <div style=\"background: #f7f7f7; padding: 8px; border-radius: 4px; word-break: break-all;\">${text}</div>
        ${debugInfo}
    `;
    
    document.body.appendChild(preview);
    
    setTimeout(() => {
        preview.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => preview.remove(), 300);
    }, 4000);
}

// Add styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Initialize
function initialize() {
    createLogButtons();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

const observer = new MutationObserver(() => initialize());
observer.observe(document.body, { childList: true, subtree: true });

console.log('StarRez Package Logger loaded!');
