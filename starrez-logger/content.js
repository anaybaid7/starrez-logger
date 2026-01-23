// ============================================================================
// StarRez Package Logger v3.1 - "GHOST BUTTON" FIX
// ============================================================================
// PURPOSE: Automates logging for UWP Front Desk operations in StarRez
// 
// FEATURES:
// 1. Package Log Buttons - Auto-retries until keys load
// 2. Lockout Log Button - Scoped to VISIBLE profile only (Fixes refresh bug)
// 3. Print Label Button - Standard package label
//
// AUTHOR: Front Desk Automation Team
// LAST UPDATED: January 2026
// ============================================================================

const CONFIG = {
    DEBUG: true, 
    RESIDENCE_PATTERN: /[A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z]/i,
    STUDENT_NUMBER_PATTERN: /^\d{8}$/,
    RETRY_INTERVAL: 500,    // Checks every 0.5s (Very fast response)
    PREVIEW_DURATION: 4000
};

// ============================================================================
// STATE MANAGEMENT & UTILS
// ============================================================================

const state = { lastExtracted: { name: null } };
const log = (...args) => CONFIG.DEBUG && console.log('[PKG-LOGGER]', ...args);

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
    return 'X.X';
}

function getCurrentBreadcrumb() {
    const breadcrumbs = document.querySelectorAll('habitat-header-breadcrumb-item');
    for (const crumb of breadcrumbs) {
        const text = crumb.textContent.trim();
        if (text.includes(',') && !text.includes('Dashboard')) return text;
    }
    return null;
}

function getStudentData() {
    // Crucial: Only look at the VISIBLE container
    const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    const text = container.innerText;
    
    const idMatch = text.match(/Student Number\s+(\d{8})/);
    if (!idMatch) return null;
    
    let room = null;
    const roomMatch = text.match(/Room\s+([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])\/([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])/i);
    if (roomMatch) room = roomMatch[2];
    
    if (!room) {
        const rezMatch = text.match(/[A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z]/i);
        if (rezMatch) room = rezMatch[0];
    }

    const name = getCurrentBreadcrumb();
    if (name && idMatch && room) {
        return { fullName: name, studentNumber: idMatch[1], roomSpace: room };
    }
    return null;
}

// ============================================================================
// KEY EXTRACTION (STRICT)
// ============================================================================

function extractKeyCodes(studentID) {
    const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    const text = container.innerText;
    
    const allMatches = Array.from(text.matchAll(/(?:Bedroom|Suite|Floor|Unit|Key|LOANER)[^:\r\n]*:\s*([A-Z0-9]+)/gi));
    const isReportMode = /Entry Name.*Student Number/i.test(text) || allMatches.length > 4;

    const validKeys = new Set();

    if (isReportMode && studentID) {
        // STRICT MODE: ID ... Key : Code
        const strictRegex = new RegExp(`${studentID}[\\s\\S]{0,300}?(?:Bedroom|Suite|Floor|Unit|Key|LOANER)[^:\\r\\n]*:\\s*([A-Z0-9]+)`, "gi");
        const strictMatches = Array.from(text.matchAll(strictRegex));
        strictMatches.forEach(m => processKey(m[1], studentID, validKeys));
    } else {
        allMatches.forEach(m => processKey(m[1], studentID, validKeys));
    }
    
    return Array.from(validKeys);
}

function processKey(code, studentID, set) {
    code = code.trim();
    if (code.length > 2 && !/[a-z]/.test(code) && code !== studentID) {
        set.add(code);
    }
}

// ============================================================================
// LOGIC
// ============================================================================

function generateLockout() {
    const data = getStudentData();
    if (!data) return { success: false, error: 'Student data not found' };
    
    const keys = extractKeyCodes(data.studentNumber);
    if (keys.length === 0) return { success: false, error: 'No keys found' };
    
    const staff = getInitials(getStaffName());
    const student = getInitials(data.fullName);
    
    const log = `${student} (${data.studentNumber}) ${data.roomSpace} KC: ${keys.join(', ')}; [Fill in Reason] - ${staff}`;
    return { success: true, logEntry: log };
}

function generatePackage(count) {
    const data = getStudentData();
    if (!data) return { success: false };
    const staff = getInitials(getStaffName());
    const student = getInitials(data.fullName);
    const time = new Date().toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'});
    const log = `${student} (${data.studentNumber}) ${data.roomSpace} ${count} pkg${count>1?'s':''} @ ${time} - ${staff}`;
    return { success: true, logEntry: log };
}

function generateLabel() {
    const data = getStudentData();
    if (!data) return { success: false };
    const staff = getInitials(getStaffName());
    const now = new Date();
    const date = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()} ${now.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})}`;
    let name = data.fullName;
    if (name.includes(',')) {
        const [l, f] = name.split(',');
        name = `${f.trim()} ${l.trim()}`;
    }
    const log = `${date}\n${data.studentNumber}\n${name}\n${data.roomSpace}\nFDA Name: ${staff}`;
    return { success: true, logEntry: log };
}

// ============================================================================
// UI & INJECTION
// ============================================================================

function createBtn(text, gradient, onClick, id) {
    const b = document.createElement('button');
    b.textContent = text;
    b.id = id; // Important for duplicate checking
    b.style.cssText = `margin-left:10px;padding:4px 10px;background:${gradient};color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    return b;
}

async function handleClick(btn, type, count, origText, gradient) {
    let res;
    if (type === 'lockout') res = generateLockout();
    else if (type === 'label') res = generateLabel();
    else res = generatePackage(count);
    
    if (res.success) {
        await navigator.clipboard.writeText(res.logEntry);
        btn.textContent = 'Copied!';
        btn.style.background = '#11998e';
        setTimeout(() => { btn.textContent = origText; btn.style.background = gradient; }, 2000);
    } else {
        alert('Error: ' + (res.error || 'Unknown'));
    }
}

function scanAndInject() {
    // 1. TARGET THE ACTIVE TAB ONLY (This is the fix)
    const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    if (!container) return;

    // 2. Package Buttons
    container.querySelectorAll('button').forEach(btn => {
        if (btn.textContent.includes('Issue') && !btn.nextElementSibling?.id?.startsWith('pkg-btn')) {
            const b = createBtn('Copy Log', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', (el) => handleClick(el, 'pkg', 1, 'Copy Log', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'), 'pkg-btn-' + Math.random());
            btn.parentNode.insertBefore(b, btn.nextSibling);
        }
    });

    // 3. Lockout Button (Scoped to Container)
    if (/EntryID:|Rez 360/i.test(container.innerText)) {
        // Does the button ALREADY exist in THIS container?
        if (!container.querySelector('#lockout-log-btn')) {
            
            // Find "Keys" Header (H3) or "Related" Header
            const anchors = Array.from(container.querySelectorAll('h3, h2, h4, strong, span'));
            const bestAnchor = anchors.find(el => {
                const text = el.innerText.trim();
                return (text === 'Keys' || text === 'Related' || text.includes('Loaner Keys Report'));
            });

            if (bestAnchor) {
                const b = createBtn('Copy Lockout', 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', (el) => handleClick(el, 'lockout', 1, 'Copy Lockout', 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'), 'lockout-log-btn');
                bestAnchor.appendChild(b);
                log('Lockout button injected in active tab');
            }
        }
    }
    
    // 4. Print Label Button
    const entryAction = container.querySelector('button[title="Entry Actions"], button') || Array.from(container.querySelectorAll('button')).find(b => /Entry Actions/i.test(b.textContent));
    if (entryAction && !container.querySelector('#label-btn')) {
        const b = createBtn('Print Label', 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', (el) => handleClick(el, 'label', 1, 'Print Label', 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'), 'label-btn');
        entryAction.parentNode.insertBefore(b, entryAction);
    }
}

// Start
function init() {
    log('StarRez Logger v3.1 Started');
    setInterval(scanAndInject, CONFIG.RETRY_INTERVAL); 
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
