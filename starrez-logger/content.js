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
    
    // Find the active detail container
    const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;

    // 1. Get student name from breadcrumb (most reliable)
    const breadcrumbs = detailContainer.querySelectorAll('habitat-header-breadcrumb-item');
    for (let crumb of breadcrumbs) {
        const text = crumb.textContent.trim();
        if (text.includes(',') && !text.includes('Dashboard') && !text.includes('Desk') && !text.includes('Front')) {
            data.fullName = text;
            break;
        }
    }
    
    // 2. Get Student Number - Look for specific 8-digit pattern within student info
    const snoMatch = detailContainer.innerText.match(/Student Number\s+(\d{8})/);
    if (snoMatch) {
        data.studentNumber = snoMatch[1];
    }

    // 3. FIXED: Permanent Room/Bedspace Fix
    // We target the main detail list items to avoid picking up report data or email addresses
    const listItems = Array.from(detailContainer.querySelectorAll('.starrez-list-item, .ui-widget-content, div'));
    
    // Find the element that explicitly says "Room" and then look for the pattern Building-Room
    for (let i = 0; i < listItems.length; i++) {
        const text = listItems[i].innerText.trim();
        if (text === 'Room' && listItems[i+1]) {
            let roomValue = listItems[i+1].innerText.trim();
            
            // Check if it matches the room pattern (e.g., CMH-05213/CMH-05213b)
            // It must contain a dash and a number to be valid
            if (roomValue.includes('-') && /\d/.test(roomValue)) {
                // Grab the bedspace (part after slash) if it exists
                if (roomValue.includes('/')) {
                    const parts = roomValue.split('/');
                    data.roomSpace = parts[parts.length - 1].trim();
                } else {
                    data.roomSpace = roomValue;
                }
                break;
            }
        }
    }

    // Secondary Fallback: If list search failed, use a very strict regex that requires building code + dash
    if (!data.roomSpace) {
        const strictMatch = detailContainer.innerText.match(/\b([A-Z]{2,4}-\d+[a-z]?)\b/);
        if (strictMatch) data.roomSpace = strictMatch[1];
    }
    
    return Object.keys(data).length > 0 ? data : null;
}

// Get initials from full name in format: FirstInitials.LastInitials
function getInitials(fullName) {
    if (fullName.includes(',')) {
        const parts = fullName.split(',').map(p => p.trim());
        const lastName = parts[0];
        const firstName = parts[1] || '';
        const firstInitials = firstName.split(' ').filter(n => n.length > 0).map(n => n[0]).join('');
        const lastInitials = lastName.split(' ').filter(n => n.length > 0).map(n => n[0]).join('');
        return `${firstInitials}.${lastInitials}`.toUpperCase();
    }
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
        const staffInitials = staffName ? getInitials(staffName).replace('.', '') : 'XX';
        const studentData = getStudentDataFromRez360();
        
        if (!studentData || !studentData.fullName) return { success: false, error: 'Could not find student name' };
        if (!studentData.studentNumber) return { success: false, error: 'Could not find student number' };
        if (!studentData.roomSpace) return { success: false, error: 'Could not find room/bed space' };
        
        const initials = getInitials(studentData.fullName);
        const time = getCurrentTime();
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} ${packageCount} pkg${packageCount > 1 ? 's' : ''} @ ${time} - ${staffInitials}`;
        
        return {
            success: true,
            logEntry: logEntry,
            data: { initials, studentNumber: studentData.studentNumber, roomSpace: studentData.roomSpace, packageCount, time, fullName: studentData.fullName, staffInitials, staffName }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (err) { return false; }
}

function createStyledButton(text, gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)') {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.cssText = `margin-left: 10px; padding: 8px 16px; background: ${gradient}; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; box-shadow: 0 2px 8px rgba(102,126,234,0.3); transition: all 0.2s ease;`;
    button.addEventListener('mouseenter', () => { button.style.transform = 'translateY(-2px)'; button.style.boxShadow = '0 4px 12px rgba(102,126,234,0.4)'; });
    button.addEventListener('mouseleave', () => { button.style.transform = 'translateY(0)'; button.style.boxShadow = '0 2px 8px rgba(102,126,234,0.3)'; });
    return button;
}

function findParcelCountElement() {
    const spans = Array.from(document.querySelectorAll('span'));
    for (let span of spans) {
        const text = span.textContent.trim();
        if (/^\d+\s+Parcel[s]?$/i.test(text) && span.children.length === 0) return span;
    }
    return null;
}

function createLogButtons() {
    const issueButtons = Array.from(document.querySelectorAll('button, input[type=\"button\"], a.button, a[class*=\"button\"]')).filter(btn => {
        const text = btn.textContent.toLowerCase();
        return text.includes('issue') && !text.includes('reissue');
    });
    if (issueButtons.length === 0) return;
    const packageCount = issueButtons.length;
    if (packageCount >= 2) {
        const parcelCountElement = findParcelCountElement();
        if (parcelCountElement && !document.getElementById('package-log-master-btn')) {
            const masterButton = createStyledButton(`Copy ${packageCount} pkgs`, 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)');
            masterButton.id = 'package-log-master-btn';
            masterButton.addEventListener('click', async (e) => {
                e.preventDefault(); e.stopPropagation();
                const result = generateLogEntry(packageCount);
                if (result.success) {
                    const copied = await copyToClipboard(result.logEntry);
                    if (copied) {
                        const originalText = masterButton.textContent;
                        masterButton.textContent = 'Copied!';
                        masterButton.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
                        showPreview(result.logEntry, result.data);
                        setTimeout(() => { masterButton.textContent = originalText; masterButton.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'; }, 2000);
                    }
                } else { alert('Error: ' + result.error); }
            });
            parcelCountElement.parentNode.insertBefore(masterButton, parcelCountElement.nextSibling);
        }
    }
    issueButtons.forEach((issueBtn, index) => {
        const buttonId = `package-log-btn-${index}`;
        if (document.getElementById(buttonId)) return;
        const logButton = createStyledButton('Copy Log');
        logButton.id = buttonId;
        logButton.addEventListener('click', async (e) => {
            e.preventDefault(); e.stopPropagation();
            const result = generateLogEntry(1);
            if (result.success) {
                const copied = await copyToClipboard(result.logEntry);
                if (copied) {
                    const originalText = logButton.textContent;
                    logButton.textContent = 'Copied!';
                    logButton.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
                    showPreview(result.logEntry, result.data);
                    setTimeout(() => { logButton.textContent = originalText; logButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'; }, 2000);
                }
            } else { alert('Error: ' + result.error); }
        });
        issueBtn.parentNode.insertBefore(logButton, issueBtn.nextSibling);
    });
}

function showPreview(text, data) {
    const existing = document.getElementById('log-preview-popup');
    if (existing) existing.remove();
    const preview = document.createElement('div');
    preview.id = 'log-preview-popup';
    preview.style.cssText = `position: fixed; top: 20px; right: 20px; background: white; border: 2px solid #667eea; border-radius: 8px; padding: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); z-index: 10000; max-width: 400px; font-family: monospace; font-size: 13px; animation: slideIn 0.3s ease;`;
    const staffInfo = data.staffName ? `<div style=\"font-size: 11px; color: #999; margin-bottom: 4px;\">Logged by: ${data.staffName}</div>` : '';
    preview.innerHTML = `<div style=\"font-weight: bold; margin-bottom: 8px; color: #667eea;\">Copied to Clipboard:</div>${staffInfo}<div style=\"background: #f7f7f7; padding: 8px; border-radius: 4px; word-break: break-all;\">${text}</div><div style=\"font-size: 10px; color: #ccc; margin-top: 8px;\">Student: ${data.fullName} | Room: ${data.roomSpace}</div>`;
    document.body.appendChild(preview);
    setTimeout(() => { preview.style.animation = 'slideOut 0.3s ease'; setTimeout(() => preview.remove(), 300); }, 4000);
}

const style = document.createElement('style');
style.textContent = `@keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(400px); opacity: 0; } }`;
document.head.appendChild(style);

function initialize() { createLogButtons(); }
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initialize); } else { initialize(); }
const observer = new MutationObserver(() => initialize());
observer.observe(document.body, { childList: true, subtree: true });

console.log('StarRez Package Logger loaded!');
