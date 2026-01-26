// ============================================================================
// StarRez Package Logger v2.6 - FINAL STABLE & STRICT
// ============================================================================
// PURPOSE: Automates logging for UWP Front Desk operations in StarRez
// 
// FEATURES:
// 1. Package Log Buttons - Generate formatted package pickup logs
// 2. Lockout Log Button - Generate formatted lockout key logs (Profile Only)
// 3. Print Label Button - Generate formatted package labels for printing
//
// AUTHOR: Front Desk Automation Team
// LAST UPDATED: January 2026
// ============================================================================

const CONFIG = {
    DEBUG: true, 
    
    // Pattern matching
    RESIDENCE_PATTERN: /[A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z]/i,
    STUDENT_NUMBER_PATTERN: /^\d{8}$/,
    
    // Timing configuration
    CACHE_DURATION: 10000,            
    INIT_DEBOUNCE: 300,              
    OBSERVER_DEBOUNCE: 500,          
    BUTTON_ENABLE_DELAY: 200, // Faster button enable
    PREVIEW_DURATION: 4000,          
    MAX_VALIDATION_ATTEMPTS: 20
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
    lastExtracted: { name: null, studentNumber: null, roomSpace: null, timestamp: null },
    lastBreadcrumb: null,
    validationAttempts: 0,
    timers: { init: null, observer: null }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const log = (...args) => CONFIG.DEBUG && console.log('[PKG-LOGGER]', ...args);
const error = (...args) => console.error('[PKG-LOGGER ERROR]', ...args);

const clearTimer = (timerName) => {
    if (state.timers[timerName]) {
        clearTimeout(state.timers[timerName]);
        state.timers[timerName] = null;
    }
};

// ============================================================================
// DATA EXTRACTION
// ============================================================================

function getStaffName() {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
        const match = script.textContent.match(/full_name:\s*`([^`]+)`/);
        if (match?.[1]) return match[1];
    }
    return null;
}

function getInitials(fullName) {
    if (!fullName) return 'X.X';
    if (fullName.includes(',')) {
        const [lastName, firstName = ''] = fullName.split(',').map(p => p.trim());
        const getInitials = (name) => name.split(/\s+/).filter(n => n.length > 0).map(n => n[0].toUpperCase()).join('');
        return `${getInitials(firstName)}.${getInitials(lastName)}`;
    }
    const parts = fullName.split(/\s+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
        const firstInitials = parts.slice(0, -1).map(n => n[0].toUpperCase()).join('');
        const lastInitial = parts[parts.length - 1][0].toUpperCase();
        return `${firstInitials}.${lastInitial}`;
    }
    return parts.map(p => p[0]).join('').toUpperCase() + '.X';
}

function getCurrentBreadcrumb() {
    const breadcrumbs = document.querySelectorAll('habitat-header-breadcrumb-item');
    for (const crumb of breadcrumbs) {
        const text = crumb.textContent.trim();
        if (text.includes(',') && !text.includes('Dashboard') && !text.includes('Desk')) {
            return text;
        }
    }
    return null;
}

// ============================================================================
// STUDENT DATA LOGIC
// ============================================================================

function getStudentDataFromRez360() {
    const data = {};
    const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    let containerText = detailContainer.innerText;
    
    const entryIdIndex = containerText.indexOf('EntryID:');
    if (entryIdIndex !== -1) {
        containerText = containerText.substring(entryIdIndex);
    }
    
    data.fullName = getCurrentBreadcrumb();
    if (!data.fullName) return null;
    
    const studentNumMatch = containerText.match(/Student Number\s+(\d{8})/);
    if (studentNumMatch) data.studentNumber = studentNumMatch[1];
    else return null;
    
    data.roomSpace = extractBedspace(containerText);
    if (!data.roomSpace) return null;
    
    return validateStudentData(data);
}

function extractBedspace(containerText) {
    const methods = [
        () => {
            const match = containerText.match(/Room\s+([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])\/([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])/i);
            return match ? match[2] : null;
        },
        () => {
            const rez360Section = containerText.match(/Rez 360[\s\S]*?(?=Activity|Related|$)/);
            if (rez360Section) {
                const match = rez360Section[0].match(CONFIG.RESIDENCE_PATTERN);
                return match ? match[0] : null;
            }
        },
        () => {
            const match = containerText.match(/Room Space[\s\S]*?([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])/i);
            return match ? match[1] : null;
        }
    ];
    
    for (const method of methods) {
        const result = method();
        if (result) return result;
    }
    return null;
}

function validateStudentData(data) {
    if (data.fullName && CONFIG.STUDENT_NUMBER_PATTERN.test(data.studentNumber) && CONFIG.RESIDENCE_PATTERN.test(data.roomSpace)) {
        state.lastExtracted = { ...data, timestamp: Date.now() };
        return data;
    }
    return null;
}

function getCurrentTime() {
    const now = new Date();
    const hours = now.getHours() % 12 || 12;
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${now.getHours() >= 12 ? 'pm' : 'am'}`;
}

function getFormattedDateTime() {
    const now = new Date();
    const hours = now.getHours() % 12 || 12;
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${hours}:${minutes}${now.getHours() >= 12 ? 'p.m.' : 'a.m.'}`;
}

// ============================================================================
// CORE LOG GENERATORS
// ============================================================================

function generateLogEntry(packageCount = 1) {
    try {
        const studentData = getStudentDataFromRez360();
        if (!studentData) return { success: false, error: 'Data not found' };
        
        const staffName = getStaffName();
        const initials = getInitials(studentData.fullName);
        const staffInitials = staffName ? getInitials(staffName) : 'X.X';
        const time = getCurrentTime();
        
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} ${packageCount} pkg${packageCount > 1 ? 's' : ''} @ ${time} - ${staffInitials}`;
        
        return { success: true, logEntry, data: { ...studentData, staffInitials, staffName } };
    } catch (err) { return { success: false, error: err.message }; }
}

/**
 * STRICT KEY EXTRACTION (v2.6)
 * 1. Uses Regex to find Key Codes.
 * 2. Filters out lowercase (emails/usernames).
 * 3. Filters out the Student ID itself.
 */
function extractKeyCodes(studentName, studentID) {
    const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    const text = detailContainer.innerText;
    
    // Regex finds "Label : CODE"
    const allMatches = Array.from(text.matchAll(/(?:Bedroom|Floor|Mail|Unit|Key|LOANER)[^:\r\n]*:\s*([A-Z0-9]+)/gi));
    
    // Detection for "Report Mode" (busy list)
    const isReportMode = /Entry Name.*Student Number/i.test(text) || /Loaner Keys Report/i.test(text) || allMatches.length > 4;

    if (isReportMode && studentID) {
        log(`Report Mode - Filtering for ID: ${studentID}`);
        // STRICT: Look for [StudentID] ... [Key] : [Code]
        const strictRegex = new RegExp(`${studentID}[\\s\\S]{0,300}?(?:Bedroom|Floor|Mail|Unit|Key|LOANER)[^:\\r\\n]*:\\s*([A-Z0-9]+)`, "gi");
        const strictMatches = Array.from(text.matchAll(strictRegex));
        
        if (strictMatches.length > 0) return extractUniqueCodes(strictMatches, studentID);
        
        // Fallback to Name
        if (studentName) {
            const escapedName = studentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRegex = new RegExp(`${escapedName}[\\s\\S]{0,300}?(?:Bedroom|Floor|Mail|Unit|Key|LOANER)[^:\\r\\n]*:\\s*([A-Z0-9]+)`, "gi");
            const nameMatches = Array.from(text.matchAll(nameRegex));
            if (nameMatches.length > 0) return extractUniqueCodes(nameMatches, studentID);
        }
        return null;
    } 
    
    return extractUniqueCodes(allMatches, studentID);
}

function extractUniqueCodes(matches, studentID) {
    if (!matches || matches.length === 0) return null;
    const uniqueCodes = new Set();
    matches.forEach(m => {
        const code = m[1].trim();
        // FILTER: Length > 2, No Lowercase (removes emails), Not Student ID
        if (code.length > 2 && !/[a-z]/.test(code) && code !== studentID) {
            uniqueCodes.add(code);
        }
    });
    return Array.from(uniqueCodes);
}

function generateLockoutEntry() {
    try {
        const studentData = getStudentDataFromRez360();
        if (!studentData) return { success: false, error: 'Data not found' };
        
        const keyCodes = extractKeyCodes(studentData.fullName, studentData.studentNumber);
        if (!keyCodes || keyCodes.length === 0) return { success: false, error: 'No Loaner Keys found for this student' };
        
        const staffName = getStaffName();
        const staffInitials = staffName ? getInitials(staffName) : 'X.X';
        const initials = getInitials(studentData.fullName);
        
        // FINAL FORMAT: Semicolon added
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} KC: ${keyCodes.join(', ')}; [Fill in Reason] - ${staffInitials}`;
        
        return { success: true, logEntry, data: { ...studentData, keyCodes, staffInitials, staffName } };
    } catch (err) { return { success: false, error: err.message }; }
}

function generatePackageLabel() {
    try {
        const studentData = getStudentDataFromRez360();
        if (!studentData) return { success: false, error: 'Data not found' };
        
        const staffName = getStaffName();
        const staffInitials = staffName ? getInitials(staffName) : 'X.X';
        const dateTime = getFormattedDateTime();
        
        let displayName = studentData.fullName;
        if (displayName.includes(',')) {
            const [lastName, firstName] = displayName.split(',').map(p => p.trim());
            displayName = `${firstName} ${lastName}`;
        }
        
        const labelText = `${dateTime}\n${studentData.studentNumber}\n${displayName}\n${studentData.roomSpace}\nFDA: ${staffInitials}`;
        return { success: true, logEntry: labelText, data: { ...studentData, dateTime, staffInitials, staffName } };
    } catch (err) { return { success: false, error: err.message }; }
}

async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } 
    catch (err) { return false; }
}

// ============================================================================
// UI COMPONENTS & BUTTONS
// ============================================================================

function createStyledButton(text, gradient) {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.cssText = `
        margin-left: 10px; padding: 8px 16px; background: ${gradient}; color: white;
        border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px;
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3); transition: all 0.2s ease;
    `;
    button.addEventListener('mouseenter', () => { button.style.transform = 'translateY(-2px)'; button.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)'; });
    button.addEventListener('mouseleave', () => { button.style.transform = 'translateY(0)'; button.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)'; });
    return button;
}

function showPreview(text, data) {
    document.getElementById('log-preview-popup')?.remove();
    const preview = document.createElement('div');
    preview.id = 'log-preview-popup';
    preview.style.cssText = `
        position: fixed; top: 20px; right: 20px; background: white; border: 2px solid #667eea;
        border-radius: 8px; padding: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); z-index: 10000;
        max-width: 500px; font-family: monospace; font-size: 13px; animation: slideIn 0.3s ease;
    `;
    
    let debugInfo = '';
    if (data.keyCodes) debugInfo = `Student: ${data.fullName}<br/>Keys: ${data.keyCodes.join(', ')}`;
    else debugInfo = `Student: ${data.fullName}<br/>Room: ${data.roomSpace}`;

    preview.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 8px; color: #667eea;">Copied to Clipboard</div>
        <div style="font-size: 11px; color: #999; margin-bottom: 4px;">Logged by: ${data.staffName || 'Unknown'}</div>
        <div style="background: #f7f7f7; padding: 8px; border-radius: 4px; word-break: break-all; font-weight: 600;">${text.replace(/\n/g, '<br>')}</div>
        <div style="font-size: 10px; color: #ccc; margin-top: 8px;">${debugInfo}</div>
    `;
    document.body.appendChild(preview);
    setTimeout(() => { preview.remove(); }, CONFIG.PREVIEW_DURATION);
}

async function handleButtonClick(button, count, originalText, gradient, type) {
    if (button.disabled) return;
    let result = (type === 'lockout') ? generateLockoutEntry() : (type === 'label') ? generatePackageLabel() : generateLogEntry(count);
    
    if (result.success) {
        if (await copyToClipboard(result.logEntry)) {
            button.textContent = 'Copied!';
            button.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
            showPreview(result.logEntry, result.data);
            setTimeout(() => { button.textContent = originalText; button.style.background = gradient; }, 2000);
        }
    } else { alert('❌ Error: ' + result.error); }
}

// ----------------------------------------------------------------------------
// BUTTON CREATION LOGIC
// ----------------------------------------------------------------------------

function createLockoutButton(retryCount = 0) {
    const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    
    // 1. Strict Profile Check: Are we on a student profile?
    const isProfile = /EntryID:|Rez 360/i.test(detailContainer.innerText);
    if (!isProfile) return; 

    // 2. Prevent Duplicate Buttons
    if (document.getElementById('lockout-log-btn')) return;

    // 3. Find Anchor: Look for "KEYS", "Key Code", or "Loaner"
    const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
        if (el.offsetParent === null || ['SCRIPT','STYLE'].includes(el.tagName)) return false;
        // Looking for explicit header text or labels
        return (/Key Code|KEYS|LOANER/i.test(el.textContent)) && el.textContent.length < 150;
    });

    if (candidates.length === 0) {
        // RETRY: Keys section might not be loaded yet
        if (retryCount < 5) {
            log(`Keys section not found, retrying... (${retryCount + 1}/5)`);
            setTimeout(() => createLockoutButton(retryCount + 1), 500);
        }
        return;
    }
    
    // Sort by length to find the specific label, not the container
    candidates.sort((a, b) => a.textContent.length - b.textContent.length);
    const bestTarget = candidates[0];

    const gradient = 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)';
    const button = createStyledButton('Loading...', gradient);
    button.id = 'lockout-log-btn';
    button.disabled = true; button.style.opacity = '0.6'; button.style.cursor = 'not-allowed';
    
    setTimeout(() => { button.disabled = false; button.style.opacity = '1'; button.style.cursor = 'pointer'; button.textContent = 'Copy Lockout'; }, CONFIG.BUTTON_ENABLE_DELAY);
    
    button.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handleButtonClick(button, 1, 'Copy Lockout', gradient, 'lockout'); });
    bestTarget.appendChild(button);
    log('Lockout button created at:', bestTarget.tagName);
}

function createLogButtons() {
    // Individual Package Buttons
    const issueButtons = Array.from(document.querySelectorAll('button, input[type="button"], a.button')).filter(b => b.textContent.toLowerCase().includes('issue') && !b.textContent.toLowerCase().includes('reissue'));
    issueButtons.forEach((btn, i) => {
        if (document.getElementById(`pkg-btn-${i}`)) return;
        const b = createStyledButton('Copy Log', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)');
        b.id = `pkg-btn-${i}`;
        b.addEventListener('click', (e) => { e.preventDefault(); handleButtonClick(b, 1, 'Copy Log', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 'package'); });
        btn.parentNode.insertBefore(b, btn.nextSibling);
    });

    // Master Package Button
    const parcelCount = Array.from(document.querySelectorAll('span')).find(s => /^\d+\s+Parcel[s]?$/i.test(s.textContent.trim()));
    if (parcelCount && !document.getElementById('pkg-master')) {
        const count = parseInt(parcelCount.textContent);
        if (count > 1) {
            const b = createStyledButton(`Copy ${count} pkgs`, 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)');
            b.id = 'pkg-master';
            b.addEventListener('click', (e) => { e.preventDefault(); handleButtonClick(b, count, `Copy ${count} pkgs`, 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', 'package'); });
            parcelCount.parentNode.insertBefore(b, parcelCount.nextSibling);
        }
    }

    createLockoutButton();
    
    // Print Label Button
    const entryActions = Array.from(document.querySelectorAll('button')).find(el => /Entry Actions/i.test(el.textContent));
    if (entryActions && !document.getElementById('pkg-label')) {
        const b = createStyledButton('Print Label', 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)');
        b.id = 'pkg-label';
        b.addEventListener('click', (e) => { e.preventDefault(); handleButtonClick(b, 1, 'Print Label', 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', 'label'); });
        entryActions.parentNode.insertBefore(b, entryActions);
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function clearOldButtons() {
    document.querySelectorAll('[id^="pkg-btn-"], #pkg-master, #lockout-log-btn, #pkg-label').forEach(b => b.remove());
    state.lastExtracted = { name: null };
}

function initialize() {
    clearTimer('init');
    state.timers.init = setTimeout(() => {
        const currentBreadcrumb = getCurrentBreadcrumb();
        
        // LOOP FIX: Only clear buttons if the STUDENT actually changes.
        if (currentBreadcrumb && currentBreadcrumb !== state.lastBreadcrumb) {
            log('New profile detected - Refreshing buttons');
            clearOldButtons();
            state.lastBreadcrumb = currentBreadcrumb;
        }

        const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
        if (!container.innerText.includes('EntryID:') && state.validationAttempts < CONFIG.MAX_VALIDATION_ATTEMPTS) {
            state.validationAttempts++;
            setTimeout(initialize, 500); 
            return;
        }
        
        state.validationAttempts = 0;
        createLogButtons();
    }, CONFIG.INIT_DEBOUNCE);
}

// Startup
const style = document.createElement('style');
style.textContent = `@keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
document.head.appendChild(style);

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
else initialize();

const observer = new MutationObserver(() => { clearTimer('observer'); state.timers.observer = setTimeout(initialize, CONFIG.OBSERVER_DEBOUNCE); });
observer.observe(document.body, { childList: true, subtree: true });

log('StarRez Package Logger v2.6 Loaded');
