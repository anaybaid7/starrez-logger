// StarRez Package Logger - Content Script (FIXED)

// ========== PAGE CONTEXT DETECTION ==========

// Check if we're on a Parcel/Package page
function isParcelPage() {
    const url = window.location.href.toLowerCase();
    return url.includes('parcel') || url.includes('package');
}

// Multi-signal validation for parcel context
function isParcelContextPresent() {
    const bodyText = document.body.innerText;
    
    const signals = [
        bodyText.includes('Parcel'),
        bodyText.includes('Student Number'),
        bodyText.includes('Room') || bodyText.includes('Bed Space'),
        document.querySelector('habitat-header-breadcrumb-item') !== null
    ];
    
    const signalCount = signals.filter(s => s).length;
    return signalCount >= 2;
}

// Master context check
function shouldInitialize() {
    return isParcelPage() && isParcelContextPresent();
}

// ========== CORE FUNCTIONS ==========

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
    
    // Get student name from breadcrumb
    const breadcrumbs = document.querySelectorAll('habitat-header-breadcrumb-item');
    for (let crumb of breadcrumbs) {
        const text = crumb.textContent.trim();
        if (text.includes(',') && !text.includes('Dashboard') && !text.includes('Desk') && !text.includes('Front')) {
            data.fullName = text;
            break;
        }
    }
    
    // Get student number
    const allText = document.body.innerText;
    const studentNumMatch = allText.match(/Student Number\s+(\d{8})/);
    if (studentNumMatch) {
        data.studentNumber = studentNumMatch[1];
    }
    
    // Get room/bed space - look for Room followed by space/newline and code
    const roomMatch = allText.match(/Room[:\s]+([A-Z0-9\-\/]+\d+[a-z]?)/i);
    if (roomMatch) {
        let roomString = roomMatch[1];
        // If slash, take first segment (e.g., BH-0705a from BH-0705a/BH-0705a-2)
        if (roomString.includes('/')) {
            roomString = roomString.split('/')[0];
        }
        data.roomSpace = roomString;
    }
    
    return Object.keys(data).length > 0 ? data : null;
}

// Get initials from full name
function getInitials(fullName) {
    if (fullName.includes(',')) {
        const parts = fullName.split(',').map(p => p.trim());
        const lastName = parts[0];
        const firstName = parts[1] || '';
        
        // Get all initials from first name
        const firstNameParts = firstName.split(' ').filter(p => p.length > 0);
        const firstInitials = firstNameParts.map(n => n[0]).join('');
        
        // Get all initials from last name
        const lastNameParts = lastName.split(' ').filter(p => p.length > 0);
        const lastInitials = lastNameParts.map(n => n[0]).join('');
        
        return (firstInitials + '.' + lastInitials).toUpperCase();
    }
    
    const nameParts = fullName.split(' ').filter(p => p.length > 0);
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

// Generate log entry
function generateLogEntry(packageCount = 1) {
    try {
        const staffName = getStaffName();
        const staffInitials = staffName ? getInitials(staffName) : 'XX';
        
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
        
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace}, ${packageCount} pkg${packageCount > 1 ? 's' : ''} @ ${time} - ${staffInitials}`;
        
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

// Create styled button
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

// Find parcel count element
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

// Create log buttons
function createLogButtons() {
    const issueButtons = Array.from(document.querySelectorAll('button, input[type="button"], a.button, a[class*="button"]')).filter(btn => {
        const text = btn.textContent.toLowerCase();
        return text.includes('issue') && !text.includes('reissue');
    });
    
    if (issueButtons.length === 0) {
        return;
    }
    
    const packageCount = issueButtons.length;
    
    // Master button for 2+ packages
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
    
    // Individual buttons
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

// Show preview popup
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
    
    const staffInfo = data.staffName ? `<div style="font-size: 11px; color: #999; margin-bottom: 4px;">Logged by: ${data.staffName}</div>` : '';
    const debugInfo = `<div style="font-size: 10px; color: #ccc; margin-top: 8px;">Student: ${data.fullName} | Room: ${data.roomSpace}</div>`;
    
    preview.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 8px; color: #667eea;">Copied to Clipboard:</div>
        ${staffInfo}
        <div style="background: #f7f7f7; padding: 8px; border-radius: 4px; word-break: break-all;">${text}</div>
        ${debugInfo}
    `;
    
    document.body.appendChild(preview);
    
    setTimeout(() => {
        preview.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => preview.remove(), 300);
    }, 4000);
}

// Add CSS animations
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

// ========== INITIALIZATION ==========

function initialize() {
    if (!shouldInitialize()) {
        return;
    }
    
    createLogButtons();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Throttled observer
let lastRun = 0;
const observer = new MutationObserver(() => {
    const now = Date.now();
    
    if (now - lastRun < 500) {
        return;
    }
    
    if (!shouldInitialize()) {
        return;
    }
    
    lastRun = now;
    initialize();
});

observer.observe(document.body, { childList: true, subtree: true });

console.log('StarRez Package Logger loaded!');
