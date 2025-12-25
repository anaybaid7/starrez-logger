// StarRez Package Logger - Content Script
// Pierces Shadow DOM and automates package log formatting

// Extract staff member's name from Pendo initialization script
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
    console.warn('Could not find staff name in Pendo script');
    return null;
}

// Extract student data from Rez 360 detail view
function getStudentDataFromRez360() {
    const data = {};
    
    // Get student name from page title or header
    const titleElement = document.querySelector('h1, [class*="title"], [class*="header"]');
    if (titleElement) {
        const titleText = titleElement.textContent.trim();
        // Match "Scott, Weldon - [Reserved]" format
        const nameMatch = titleText.match(/^([^-]+)/);
        if (nameMatch) {
            data.fullName = nameMatch[1].trim().replace(/\s*-\s*\[.*\]/, '');
        }
    }
    
    // Try breadcrumb as backup
    if (!data.fullName) {
        const breadcrumbs = document.querySelectorAll('habitat-header-breadcrumb-item');
        for (let crumb of breadcrumbs) {
            const text = crumb.textContent.trim();
            // Look for "Last, First" format
            if (text.includes(',') && !text.includes('Dashboard') && !text.includes('Desk')) {
                data.fullName = text;
                break;
            }
        }
    }
    
    // Get student number - look for field with label "Student Number"
    const allText = document.body.innerText;
    const studentNumMatch = allText.match(/Student Number\s+(\d{8})/);
    if (studentNumMatch) {
        data.studentNumber = studentNumMatch[1];
    }
    
    // Get room/bed space - look for "Room" field in the booking section
    // Format: "MHR-116/MHR-116a" - we want the second part (MHR-116a)
    const roomMatch = allText.match(/Room\s+([A-Z]{2,4}-\d{3}[a-z]?)(?:\/([A-Z]{2,4}-\d{3}[a-z]?))?/);
    if (roomMatch) {
        // Use the specific bed space if available (second group), otherwise use the room
        data.roomSpace = roomMatch[2] || roomMatch[1];
    }
    
    return Object.keys(data).length > 0 ? data : null;
}

// Extract student data from breadcrumb (for old dashboard view)
function getStudentDataFromBreadcrumb() {
    const breadcrumbs = document.querySelectorAll('habitat-header-breadcrumb-item');
    for (let crumb of breadcrumbs) {
        const moduleAttr = crumb.getAttribute('module');
        if (moduleAttr) {
            try {
                const moduleData = JSON.parse(moduleAttr);
                if (moduleData.dbObjectName === 'Entry' && moduleData.recordId) {
                    const nameText = crumb.textContent.trim();
                    return {
                        fullName: nameText,
                        recordId: moduleData.recordId,
                        caption: moduleData.caption
                    };
                }
            } catch (e) {
                console.log('Could not parse module data:', e);
            }
        }
    }
    return null;
}

// Extract data from table cells with data-label (for dashboard table view)
function getTableData(dataLabel) {
    const cells = document.querySelectorAll(`td[data-label="${dataLabel}"]`);
    for (let cell of cells) {
        const span = cell.querySelector('span.field');
        if (span && span.textContent.trim()) {
            return span.textContent.trim();
        }
    }
    return null;
}

// Get initials from full name
function getInitials(fullName) {
    // Handle "Last, First" format (for students like "Scott, Weldon")
    if (fullName.includes(',')) {
        const parts = fullName.split(',').map(p => p.trim());
        const lastName = parts[0];
        const firstName = parts[1] || '';
        const firstInitials = firstName.split(' ').map(n => n[0]).join('');
        const lastInitial = lastName[0];
        return (firstInitials + lastInitial).toUpperCase();
    }
    
    // Handle "First Last" format (for staff like "Anay Baid")
    const nameParts = fullName.split(' ').filter(p => p.length > 0);
    return nameParts.map(part => part[0]).join('').toUpperCase();
}

// Format current time as HH:MM am/pm
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

// Generate the log entry
function generateLogEntry() {
    try {
        // Get staff name and initials
        const staffName = getStaffName();
        const staffInitials = staffName ? getInitials(staffName) : 'XX';
        
        // Try Rez 360 format first (detail view)
        let studentData = getStudentDataFromRez360();
        
        // Fallback to breadcrumb format (old view)
        if (!studentData || !studentData.fullName) {
            const breadcrumbData = getStudentDataFromBreadcrumb();
            if (breadcrumbData) {
                studentData = {
                    fullName: breadcrumbData.fullName,
                    studentNumber: getTableData('Student Number') || breadcrumbData.recordId,
                    roomSpace: getTableData('Room Space Description') || getTableData('Bed Space')
                };
            }
        }
        
        if (!studentData || !studentData.fullName) {
            return {
                success: false,
                error: 'Could not find student name on this page'
            };
        }
        
        if (!studentData.studentNumber) {
            return {
                success: false,
                error: 'Could not find student number'
            };
        }
        
        if (!studentData.roomSpace) {
            return {
                success: false,
                error: 'Could not find room/bed space'
            };
        }
        
        // Get initials from student name
        const initials = getInitials(studentData.fullName);
        
        // Get current time
        const time = getCurrentTime();
        
        // Default to 1 package
        const packageCount = 1;
        
        // Format: WS (21035314) MHR-116a 1 pkg @ 4:37 pm - AB
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
        return {
            success: false,
            error: error.message
        };
    }
}

// Copy to clipboard
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy:', err);
        return false;
    }
}

// Create and inject the custom button
function createLogButton() {
    // Look for Issue button
    const issueButtons = document.querySelectorAll('button, input[type="button"], a.button, a[class*="button"]');
    let targetButton = null;
    
    for (let btn of issueButtons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('issue') && !text.includes('reissue')) {
            targetButton = btn;
            break;
        }
    }
    
    if (!targetButton) {
        console.log('Issue button not found on this page');
        return;
    }
    
    // Check if our button already exists
    if (document.getElementById('package-log-btn')) {
        return;
    }
    
    // Create our custom button
    const logButton = document.createElement('button');
    logButton.id = 'package-log-btn';
    logButton.textContent = 'Copy Log';
    logButton.style.cssText = `
        margin-left: 10px;
        padding: 8px 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        transition: all 0.2s ease;
    `;
    
    // Hover effect
    logButton.addEventListener('mouseenter', () => {
        logButton.style.transform = 'translateY(-2px)';
        logButton.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
    });
    
    logButton.addEventListener('mouseleave', () => {
        logButton.style.transform = 'translateY(0)';
        logButton.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)';
    });
    
    // Click handler
    logButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const result = generateLogEntry();
        
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
            } else {
                logButton.textContent = 'Copy Failed';
                setTimeout(() => {
                    logButton.textContent = 'Copy Log';
                }, 2000);
            }
        } else {
            alert('Error: ' + result.error);
        }
    });
    
    // Insert button next to Issue button
    targetButton.parentNode.insertBefore(logButton, targetButton.nextSibling);
}

// Show preview popup
function showPreview(text, data) {
    const existing = document.getElementById('log-preview-popup');
    if (existing) {
        existing.remove();
    }
    
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

// Add animation styles
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
    createLogButton();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Watch for dynamic content changes
const observer = new MutationObserver(() => {
    initialize();
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

console.log('StarRez Package Logger extension loaded!');
