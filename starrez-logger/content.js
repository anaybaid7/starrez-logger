// ============================================================================
// StarRez Package Logger v3.0 - Production-ready, profile-switch aware
// ============================================================================
// PURPOSE: Automates logging for UWP Front Desk operations in StarRez
//
// FEATURES:
// 1. Package Log Buttons - Generate formatted package pickup logs
// 2. Lockout Log Button - Generate formatted lockout key logs (Profile Only)
// 3. Print Label Button - Generate formatted package labels for printing
//
// v3.0: Profile switch without refresh, consistent UI, faster & more reliable.
// AUTHOR: Front Desk Automation Team | Maintained by Anay Baid
// LAST UPDATED: February 2026
// ============================================================================

const CONFIG = {
    DEBUG: false,

    // Pattern matching
    RESIDENCE_PATTERN: /[A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z]/i,
    STUDENT_NUMBER_PATTERN: /^\d{8}$/,

    // Timing: tuned for fast reaction to profile switches without thrashing
    INIT_DEBOUNCE: 120,
    OBSERVER_DEBOUNCE: 280,
    BUTTON_READY_DELAY: 80,
    PREVIEW_DURATION: 4000,
    SUCCESS_RESET_MS: 2200,
    MAX_VALIDATION_ATTEMPTS: 25,
    LOCKOUT_RETRY_DELAY: 400,
    LOCKOUT_MAX_RETRIES: 6
};

// ============================================================================
// STATE MANAGEMENT (profile-switch aware)
// ============================================================================

const state = {
    /** Current profile identifier: breadcrumb + path so we detect SPA navigation */
    profileKey: null,
    lastExtracted: { name: null, studentNumber: null, roomSpace: null, timestamp: null },
    validationAttempts: 0,
    timers: { init: null, observer: null },
    /** Last URL path we saw (for hash/path change detection) */
    lastPath: null
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

/** Unique key for current profile so we detect switches without full refresh */
function getProfileKey() {
    const breadcrumb = getCurrentBreadcrumb();
    const path = (location.pathname || '') + (location.hash || '');
    if (!breadcrumb) return path || null;
    return breadcrumb + '|' + path;
}

// ============================================================================
// STUDENT DATA LOGIC
// ============================================================================

function getStudentDataFromRez360() {
    const data = {};
    const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    if (!detailContainer || !detailContainer.innerText) return null;
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
    if (!detailContainer) return null;
    let text;
    try {
        text = detailContainer.innerText || '';
    } catch (_) {
        return null;
    }
    
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
        if (!keyCodes || keyCodes.length === 0) return { success: false, error: 'No keys found for this student (or key section not loaded yet)' };
        
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
    if (typeof text !== 'string') return false;
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        if (CONFIG.DEBUG) error('Clipboard write failed', err);
        return false;
    }
}

// ============================================================================
// UI COMPONENTS & BUTTONS (consistent design system)
// ============================================================================

const BUTTON_STYLES = {
    primary: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
    success: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
    shadow: '0 2px 8px rgba(37, 99, 235, 0.35)',
    shadowHover: '0 4px 14px rgba(37, 99, 235, 0.45)'
};

function createStyledButton(text, variant = 'primary') {
    const gradient = variant === 'primary' ? BUTTON_STYLES.primary : BUTTON_STYLES.primary;
    const button = document.createElement('button');
    button.textContent = text;
    button.setAttribute('data-pkg-logger-variant', variant);
    button.style.cssText = `
        margin-left: 10px; padding: 8px 16px; background: ${gradient}; color: #fff;
        border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px;
        box-shadow: ${BUTTON_STYLES.shadow}; transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease;
    `;
    button.addEventListener('mouseenter', () => {
        if (button.getAttribute('data-pkg-logger-variant') === 'success') return;
        button.style.transform = 'translateY(-2px)';
        button.style.boxShadow = BUTTON_STYLES.shadowHover;
    });
    button.addEventListener('mouseleave', () => {
        button.style.transform = 'translateY(0)';
        const v = button.getAttribute('data-pkg-logger-variant');
        button.style.boxShadow = v === 'success' ? '0 2px 8px rgba(5, 150, 105, 0.4)' : BUTTON_STYLES.shadow;
    });
    return button;
}

function setButtonSuccess(button, originalText) {
    button.setAttribute('data-pkg-logger-variant', 'success');
    button.style.background = BUTTON_STYLES.success;
    button.textContent = 'Copied!';
    setTimeout(() => {
        button.setAttribute('data-pkg-logger-variant', 'primary');
        button.style.background = BUTTON_STYLES.primary;
        button.style.boxShadow = BUTTON_STYLES.shadow;
        button.textContent = originalText;
    }, CONFIG.SUCCESS_RESET_MS);
}

function showPreview(text, data) {
    try {
        document.getElementById('log-preview-popup')?.remove();
        const preview = document.createElement('div');
        preview.id = 'log-preview-popup';
        preview.style.cssText = `
            position: fixed; top: 20px; right: 20px; background: white; border: 2px solid #2563eb;
            border-radius: 8px; padding: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); z-index: 10000;
            max-width: 500px; font-family: monospace; font-size: 13px; animation: slideIn 0.3s ease;
        `;
        const safe = (x) => (x != null ? String(x) : '');
        const d = data || {};
        let debugInfo = '';
        if (Array.isArray(d.keyCodes) && d.keyCodes.length) {
            debugInfo = `Student: ${safe(d.fullName)}<br/>Keys: ${d.keyCodes.join(', ')}`;
        } else {
            debugInfo = `Student: ${safe(d.fullName)}<br/>Room: ${safe(d.roomSpace)}`;
        }
        const safeText = safe(text).replace(/\n/g, '<br>');
        preview.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 8px; color: #2563eb;">Copied to Clipboard</div>
            <div style="font-size: 11px; color: #999; margin-bottom: 4px;">Logged by: ${safe(d.staffName) || 'Unknown'}</div>
            <div style="background: #f7f7f7; padding: 8px; border-radius: 4px; word-break: break-all; font-weight: 600;">${safeText}</div>
            <div style="font-size: 10px; color: #ccc; margin-top: 8px;">${debugInfo}</div>
        `;
        if (document.body) document.body.appendChild(preview);
        setTimeout(() => { preview.remove(); }, CONFIG.PREVIEW_DURATION);
    } catch (err) {
        error('showPreview failed', err);
    }
}

async function handleButtonClick(button, count, originalText, type) {
    if (!button || button.disabled) return;
    let result;
    try {
        result = type === 'lockout' ? generateLockoutEntry() : type === 'label' ? generatePackageLabel() : generateLogEntry(count);
    } catch (err) {
        error('handleButtonClick', err);
        alert('Error: ' + (err && err.message ? err.message : 'Something went wrong'));
        return;
    }
    if (!result) return;

    if (result.success) {
        if (await copyToClipboard(result.logEntry)) {
            setButtonSuccess(button, originalText);
            showPreview(result.logEntry, result.data);
        } else {
            alert('Could not copy to clipboard. Try selecting the text manually or check browser permissions.');
        }
    } else {
        alert('Error: ' + (result.error || 'Unknown error'));
    }
}

// ----------------------------------------------------------------------------
// BUTTON CREATION LOGIC
// ----------------------------------------------------------------------------

function createLockoutButton(retryCount = 0) {
    const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    let containerText = '';
    try {
        containerText = (detailContainer && detailContainer.innerText) || '';
    } catch (_) {
        return;
    }
    const isProfile = /EntryID:|Rez 360/i.test(containerText);
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
        if (retryCount < CONFIG.LOCKOUT_MAX_RETRIES) {
            log('Keys section not found, retrying...', retryCount + 1, '/', CONFIG.LOCKOUT_MAX_RETRIES);
            setTimeout(() => createLockoutButton(retryCount + 1), CONFIG.LOCKOUT_RETRY_DELAY);
        }
        return;
    }

    candidates.sort((a, b) => a.textContent.length - b.textContent.length);
    const bestTarget = candidates[0];

    const button = createStyledButton('Copy Lockout', 'primary');
    button.id = 'lockout-log-btn';
    button.disabled = true;
    button.style.opacity = '0.7';
    button.style.cursor = 'not-allowed';

    setTimeout(() => {
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
    }, CONFIG.BUTTON_READY_DELAY);

    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleButtonClick(button, 1, 'Copy Lockout', 'lockout');
    });
    try {
        bestTarget.appendChild(button);
    } catch (err) {
        error('Could not attach Lockout button', err);
        return;
    }
    log('Lockout button created at:', bestTarget.tagName);
}

function createLogButtons() {
    try {
        const issueButtons = Array.from(document.querySelectorAll('button, input[type="button"], a.button')).filter(b => b && b.textContent && b.textContent.toLowerCase().includes('issue') && !b.textContent.toLowerCase().includes('reissue'));
        issueButtons.forEach((btn, i) => {
            if (document.getElementById(`pkg-btn-${i}`)) return;
            const b = createStyledButton('Copy Log', 'primary');
            b.id = `pkg-btn-${i}`;
            b.addEventListener('click', (e) => { e.preventDefault(); handleButtonClick(b, 1, 'Copy Log', 'package'); });
            if (btn.parentNode) btn.parentNode.insertBefore(b, btn.nextSibling);
        });

        const parcelCount = Array.from(document.querySelectorAll('span')).find(s => s && s.textContent && /^\d+\s+Parcel[s]?$/i.test(s.textContent.trim()));
        if (parcelCount && !document.getElementById('pkg-master') && parcelCount.parentNode) {
            const count = parseInt(parcelCount.textContent, 10);
            if (!isNaN(count) && count > 1) {
                const label = `Copy ${count} pkgs`;
                const b = createStyledButton(label, 'primary');
                b.id = 'pkg-master';
                b.addEventListener('click', (e) => { e.preventDefault(); handleButtonClick(b, count, label, 'package'); });
                parcelCount.parentNode.insertBefore(b, parcelCount.nextSibling);
            }
        }

        createLockoutButton();

        const entryActions = Array.from(document.querySelectorAll('button')).find(el => el && el.textContent && /Entry Actions/i.test(el.textContent));
        if (entryActions && !document.getElementById('pkg-label') && entryActions.parentNode) {
            const b = createStyledButton('Print Label', 'primary');
            b.id = 'pkg-label';
            b.addEventListener('click', (e) => { e.preventDefault(); handleButtonClick(b, 1, 'Print Label', 'label'); });
            entryActions.parentNode.insertBefore(b, entryActions);
        }
    } catch (err) {
        error('createLogButtons failed', err);
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function clearOldButtons() {
    try {
        document.querySelectorAll('[id^="pkg-btn-"], #pkg-master, #lockout-log-btn, #pkg-label').forEach(b => { try { b.remove(); } catch (_) {} });
        document.getElementById('log-preview-popup')?.remove();
    } catch (_) {}
    state.lastExtracted = { name: null, studentNumber: null, roomSpace: null, timestamp: null };
}

function initialize() {
    clearTimer('init');
    state.timers.init = setTimeout(() => {
        try {
            const newProfileKey = getProfileKey();
            const profileChanged = newProfileKey !== null && newProfileKey !== state.profileKey;

            if (profileChanged) {
                log('Profile or navigation changed - clearing and re-injecting');
                clearOldButtons();
                state.profileKey = newProfileKey;
                state.validationAttempts = 0;
            }

            const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
            let containerText = '';
            try {
                containerText = (container && container.innerText) || '';
            } catch (_) {
                containerText = '';
            }
            const isProfilePage = containerText.includes('EntryID:') || containerText.includes('Rez 360');

            if (!isProfilePage) {
                if (state.validationAttempts < CONFIG.MAX_VALIDATION_ATTEMPTS) {
                    state.validationAttempts++;
                    setTimeout(initialize, 350);
                }
                return;
            }

            state.validationAttempts = 0;
            state.profileKey = state.profileKey || newProfileKey;
            createLogButtons();
        } catch (err) {
            error('initialize failed', err);
        }
    }, CONFIG.INIT_DEBOUNCE);
}

// Startup: inject styles and mark extension as loaded for verification
(function bootstrap() {
    try {
        const style = document.createElement('style');
        style.textContent = `@keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
        if (document.head) document.head.appendChild(style);
        document.documentElement.setAttribute('data-pkg-logger', 'loaded');
    } catch (_) {}

    function scheduleInit() {
        clearTimer('observer');
        state.timers.observer = setTimeout(initialize, CONFIG.OBSERVER_DEBOUNCE);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    try {
        const observer = new MutationObserver(scheduleInit);
        observer.observe(document.body, { childList: true, subtree: true });
    } catch (err) {
        error('MutationObserver failed', err);
    }
    window.addEventListener('hashchange', scheduleInit);
    window.addEventListener('popstate', scheduleInit);

    log('StarRez Package Logger v3.0 Loaded');
})();
