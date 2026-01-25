// ============================================================================
// StarRez Package Logger v3.0 - HABITAT EDITION
// ============================================================================
// PURPOSE: Automates logging for UWP Front Desk operations in StarRez
// UPDATES (v3.0): 
// - Uses Habitat/WebComponent JSON for 100% accurate Name extraction
// - Scopes data search to active tabs (prevents "Report Mode" bugs)
// - optimized Key Regex based on your logs
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
    BUTTON_ENABLE_DELAY: 200, 
    PREVIEW_DURATION: 4000,           
    MAX_VALIDATION_ATTEMPTS: 20
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
    lastExtracted: { name: null, studentNumber: null, roomSpace: null, timestamp: null },
    lastRecordId: null, // New: track RecordID to detect profile switches
    validationAttempts: 0,
    timers: { init: null, observer: null }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const log = (...args) => CONFIG.DEBUG && console.log('[PKG-LOGGER]', ...args);

const clearTimer = (timerName) => {
    if (state.timers[timerName]) {
        clearTimeout(state.timers[timerName]);
        state.timers[timerName] = null;
    }
};

// ============================================================================
// DATA EXTRACTION (The Smart Part)
// ============================================================================

/**
 * STRATEGY: Scrape the Pendo analytics script. 
 * Your logs confirmed this is always present with "full_name".
 */
function getStaffName() {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
        // Look for the Pendo initialize block
        if (script.textContent.includes('pendo.initialize')) {
            const match = script.textContent.match(/full_name:\s*`([^`]+)`/);
            if (match?.[1]) return match[1];
        }
    }
    return null;
}

function getInitials(fullName) {
    if (!fullName) return 'X.X';
    // Clean up "Last, First" format if present
    let nameToProcess = fullName;
    if (fullName.includes(',')) {
        const [last, first] = fullName.split(',').map(s => s.trim());
        nameToProcess = `${first} ${last}`;
    }
    
    const parts = nameToProcess.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(p => p.length > 0);
    
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0]?.substring(0, 2).toUpperCase() || 'X.X';
}

/**
 * STRATEGY: Parse the Habitat Breadcrumb JSON.
 * Your logs showed: <habitat-header-breadcrumb-item module="{...caption: 'Ahmad, Zoya'...}">
 * This is 100x safer than scraping text.
 */
function getStudentNameFromBreadcrumb() {
    const breadcrumbs = document.querySelectorAll('habitat-header-breadcrumb-item');
    
    // We look for the one that represents the "Entry" (The student)
    // It usually has "dbObjectName": "Entry" in the JSON module attribute
    for (const b of breadcrumbs) {
        const moduleAttr = b.getAttribute('module');
        if (moduleAttr) {
            try {
                const data = JSON.parse(moduleAttr);
                // We want the breadcrumb that is an "Entry" and has a caption (Name)
                // We filter out "Rez 360" or "Dashboard"
                if (data.dbObjectName === 'Entry' && data.caption && !data.caption.includes('Rez 360')) {
                    state.lastRecordId = data.recordId; // Store this to detect changes
                    return data.caption; // Returns "Last, First" usually
                }
            } catch (e) {
                // JSON parse fail, ignore
            }
        }
    }
    
    // Fallback: Old text method if JSON fails
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

/**
 * Helper to find the "Active" area. 
 * Prevents scraping "hidden" tabs or background data.
 */
function getActiveContainer() {
    // 1. Try StarRez Habitat Active Tab
    const activeHabitat = document.querySelector('habitat-layout-tab-panel[active]');
    if (activeHabitat) return activeHabitat;

    // 2. Try Standard UI Tabs
    const activeUiTab = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)');
    if (activeUiTab) return activeUiTab;

    // 3. Fallback to body (Risky, but necessary sometimes)
    return document.body;
}

function getStudentDataFromRez360() {
    const container = getActiveContainer();
    const containerText = container.innerText;
    
    const data = {};
    
    // 1. Get Name (Using new Smart Breadcrumb)
    data.fullName = getStudentNameFromBreadcrumb();
    if (!data.fullName) return null;
    
    // 2. Get Student ID (Regex Scrape on Active Container)
    // We look for "Student Number" followed by digits
    const studentNumMatch = containerText.match(/Student Number\s*[:.]?\s*(\d{8})/i);
    if (studentNumMatch) data.studentNumber = studentNumMatch[1];
    else return null;
    
    // 3. Get Room (Regex Scrape)
    data.roomSpace = extractBedspace(containerText);
    if (!data.roomSpace) return null;
    
    return validateStudentData(data);
}

function extractBedspace(containerText) {
    // Strategy 1: Look for the pattern X-X-101a
    const strictMatch = containerText.match(CONFIG.RESIDENCE_PATTERN);
    if (strictMatch) return strictMatch[0];

    // Strategy 2: Look for "Room Space" label
    const labelMatch = containerText.match(/Room Space\s*[:.]?\s*([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z]?)/i);
    if (labelMatch) return labelMatch[1];

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
        if (!studentData) return { success: false, error: 'Data not found. Ensure you are on a Student Profile.' };
        
        const staffName = getStaffName();
        const initials = getInitials(studentData.fullName);
        const staffInitials = staffName ? getInitials(staffName) : 'X.X';
        const time = getCurrentTime();
        
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} ${packageCount} pkg${packageCount > 1 ? 's' : ''} @ ${time} - ${staffInitials}`;
        
        return { success: true, logEntry, data: { ...studentData, staffInitials, staffName } };
    } catch (err) { return { success: false, error: err.message }; }
}

/**
 * UPDATED KEY EXTRACTION
 * Your logs didn't find "Key Code", so we are broadening the search.
 * We now look for the word "Key" near a code, inside the active container.
 */
function extractKeyCodes(studentName, studentID) {
    const container = getActiveContainer();
    const text = container.innerText;
    
    // Regex finds "Label : CODE"
    // Expanded to catch "Bedroom Key : 123" or just "Key : 123"
    const allMatches = Array.from(text.matchAll(/(?:Bedroom|Floor|Mail|Unit|Key|LOANER)[^:\r\n]*:\s*([A-Z0-9]+)/gi));
    
    // Report Mode Filter
    const isReportMode = /Entry Name.*Student Number/i.test(text) || /Loaner Keys Report/i.test(text);

    if (isReportMode && studentID) {
        log(`Report Mode - Filtering for ID: ${studentID}`);
        // STRICT: Look for [StudentID] ... [Key] : [Code]
        const strictRegex = new RegExp(`${studentID}[\\s\\S]{0,300}?(?:Bedroom|Floor|Mail|Unit|Key|LOANER)[^:\\r\\n]*:\\s*([A-Z0-9]+)`, "gi");
        const strictMatches = Array.from(text.matchAll(strictRegex));
        
        if (strictMatches.length > 0) return extractUniqueCodes(strictMatches, studentID);
        
        // Fallback to Name
        if (studentName) {
            // Simplify name for regex (First Last)
            const simpleName = studentName.includes(',') ? studentName.split(',').reverse().join(' ').trim() : studentName;
            const escapedName = simpleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
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
        if (!keyCodes || keyCodes.length === 0) return { success: false, error: 'No keys found (Try opening the Keys tab)' };
        
        const staffName = getStaffName();
        const staffInitials = staffName ? getInitials(staffName) : 'X.X';
        const initials = getInitials(studentData.fullName);
        
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} KC: ${keyCodes.join(', ')}; [Reason] - ${staffInitials}`;
        
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
// UI COMPONENTS
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
    
    // Safer innerHTML usage
    const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, '<br>');
    
    let debugInfo = '';
    if (data.keyCodes) debugInfo = `Student: ${data.fullName}<br/>Keys: ${data.keyCodes.join(', ')}`;
    else debugInfo = `Student: ${data.fullName}<br/>Room: ${data.roomSpace}`;

    preview.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 8px; color: #667eea;">Copied to Clipboard</div>
        <div style="font-size: 11px; color: #999; margin-bottom: 4px;">Logged by: ${data.staffName || 'Unknown'}</div>
        <div style="background: #f7f7f7; padding: 8px; border-radius: 4px; word-break: break-all; font-weight: 600;">${safeText}</div>
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
    const container = getActiveContainer();
    
    // 1. Strict Profile Check
    // We check if we have a Name loaded from the breadcrumb to confirm we are on a profile
    if (!getStudentNameFromBreadcrumb()) return; 

    // 2. Prevent Duplicate
    if (document.getElementById('lockout-log-btn')) return;

    // 3. Find Anchor
    // We try to attach to the "Keys" or "Key Code" section if visible
    // If not, we attach to the main action bar
    let bestTarget = null;
    
    // Try to find a header that says "Key"
    const keyHeader = Array.from(container.querySelectorAll('*')).find(el => 
        /Key Code|KEYS|LOANER/i.test(el.textContent) && el.children.length === 0
    );

    if (keyHeader) {
        bestTarget = keyHeader.closest('div') || keyHeader.parentElement;
    } else {
        // Fallback: If we are on a profile but can't find keys, attach to top of container
        // This ensures the button appears even if the user hasn't scrolled to keys yet
        bestTarget = container.querySelector('.ui-header') || container.querySelector('h1') || container;
    }

    const gradient = 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)';
    const button = createStyledButton('Copy Lockout', gradient);
    button.id = 'lockout-log-btn';
    button.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handleButtonClick(button, 1, 'Copy Lockout', gradient, 'lockout'); });
    
    // Insert
    if (bestTarget === container) bestTarget.prepend(button);
    else bestTarget.appendChild(button);
}

function createLogButtons() {
    // We need to find the "Issue" buttons.
    // In Habitat, these might be specialized buttons.
    const buttons = Array.from(document.querySelectorAll('button'));
    const issueButtons = buttons.filter(b => b.textContent.toLowerCase().includes('issue') && !b.textContent.toLowerCase().includes('reissue'));
    
    issueButtons.forEach((btn, i) => {
        if (document.getElementById(`pkg-btn-${i}`)) return;
        const b = createStyledButton('Copy Log', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)');
        b.id = `pkg-btn-${i}`;
        b.addEventListener('click', (e) => { e.preventDefault(); handleButtonClick(b, 1, 'Copy Log', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 'package'); });
        
        // Safe insertion
        btn.parentElement.appendChild(b);
    });

    // Master Package Button logic (same as before)
    const parcelCount = Array.from(document.querySelectorAll('span')).find(s => /^\d+\s+Parcel[s]?$/i.test(s.textContent.trim()));
    if (parcelCount && !document.getElementById('pkg-master')) {
        const count = parseInt(parcelCount.textContent);
        if (count > 1) {
            const b = createStyledButton(`Copy ${count} pkgs`, 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)');
            b.id = 'pkg-master';
            b.addEventListener('click', (e) => { e.preventDefault(); handleButtonClick(b, count, `Copy ${count} pkgs`, 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', 'package'); });
            parcelCount.parentNode.appendChild(b);
        }
    }

    createLockoutButton();
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function clearOldButtons() {
    document.querySelectorAll('[id^="pkg-btn-"], #pkg-master, #lockout-log-btn, #pkg-label').forEach(b => b.remove());
}

function initialize() {
    clearTimer('init');
    state.timers.init = setTimeout(() => {
        const currentRecordId = getStudentNameFromBreadcrumb(); // Uses Name as proxy for ID change
        
        // If we moved to a new student, clear buttons
        if (currentRecordId && currentRecordId !== state.lastBreadcrumb) {
            log('New profile detected - Refreshing buttons');
            clearOldButtons();
            state.lastBreadcrumb = currentRecordId;
        }

        // Only create buttons if we have found a student
        if (getStudentNameFromBreadcrumb()) {
             createLogButtons();
             state.validationAttempts = 0;
        } else if (state.validationAttempts < CONFIG.MAX_VALIDATION_ATTEMPTS) {
            state.validationAttempts++;
            setTimeout(initialize, 500); 
        }
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

log('StarRez Package Logger v3.0 (Habitat) Loaded');
