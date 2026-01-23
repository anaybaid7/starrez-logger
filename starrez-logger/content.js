// ============================================================================
// StarRez Package Logger v3.0 - FINAL PRODUCTION BUILD
// ============================================================================
// PURPOSE: Automates logging for UWP Front Desk operations in StarRez
// 
// FEATURES:
// 1. Package Log Buttons - Auto-retries until keys load
// 2. Lockout Log Button - Targets specific H3 "Keys" Header & Filters by Student ID
// 3. Print Label Button - Standard package label generation
//
// AUTHOR: Front Desk Automation Team
// LAST UPDATED: January 2026
// ============================================================================

const CONFIG = {
    DEBUG: true, 
    RESIDENCE_PATTERN: /[A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z]/i,
    STUDENT_NUMBER_PATTERN: /^\d{8}$/,
    
    // Heartbeat: Checks for buttons every 800ms to handle SPA navigation
    RETRY_INTERVAL: 800,    
    PREVIEW_DURATION: 4000
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
    lastExtracted: { name: null },
    lastBreadcrumb: null,
    timers: { init: null }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const log = (...args) => CONFIG.DEBUG && console.log('[PKG-LOGGER]', ...args);
const error = (...args) => console.error('[PKG-LOGGER ERROR]', ...args);

// ============================================================================
// DATA EXTRACTION & LOGIC
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
    const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    const text = container.innerText;
    
    // Find Student ID
    const idMatch = text.match(/Student Number\s+(\d{8})/);
    if (!idMatch) return null;
    
    // Find Room
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
// KEY EXTRACTION (STRICT ID MATCHING)
// ============================================================================

function extractKeyCodes(studentID) {
    const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    const text = container.innerText;
    
    // 1. Initial Scan for any keys
    const allMatches = Array.from(text.matchAll(/(?:Bedroom|Suite|Floor|Unit|Key|LOANER)[^:\r\n]*:\s*([A-Z0-9]+)/gi));
    
    // 2. Report Detection: Is there a "Loaner Keys Report" or just a busy list?
    const isReportMode = /Entry Name.*Student Number/i.test(text) || /Loaner Keys Report/i.test(text) || allMatches.length > 4;

    const validKeys = new Set();

    if (isReportMode && studentID) {
        // STRICT MODE: Look for [StudentID] ... [KeyLabel] : [Code]
        // This regex ensures we only grab keys listed under the CURRENT Student ID
        const strictRegex = new RegExp(`${studentID}[\\s\\S]{0,300}?(?:Bedroom|Suite|Floor|Unit|Key|LOANER)[^:\\r\\n]*:\\s*([A-Z0-9]+)`, "gi");
        const strictMatches = Array.from(text.matchAll(strictRegex));
        strictMatches.forEach(m => processKey(m[1], studentID, validKeys));
    } else {
        // STANDARD MODE: Grab any key found (for clean profiles)
        allMatches.forEach(m => processKey(m[1], studentID, validKeys));
    }
    
    return Array.from(validKeys);
}

function processKey(code, studentID, set) {
    code = code.trim();
    // FILTER: 
    // 1. Must be > 2 chars
    // 2. Must NOT contain lowercase (filters out usernames/emails)
    // 3. Must NOT match the student ID
    if (code.length > 2 && !/[a-z]/.test(code) && code !== studentID) {
        set.add(code);
    }
}

// ============================================================================
// LOG GENERATORS
// ============================================================================

function generateLockout() {
    const data = getStudentData();
    if (!data) return { success: false, error: 'Student data not found. Wait for profile to load.' };
    
    const keys = extractKeyCodes(data.studentNumber);
    if (keys.length === 0) return { success: false, error: 'No keys found for this student ID.' };
    
    const staff = getInitials(getStaffName());
    const student = getInitials(data.fullName);
    
    // Format: B.K (21184880) V1-N5-111a KC: 20AA130; [Fill in Reason] - A.B
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
// UI & EVENTS
// ============================================================================

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
        showPreview(res.logEntry);
    } else {
        alert('Error: ' + (res.error || 'Unknown'));
    }
}

function showPreview(text) {
    document.getElementById('log-preview')?.remove();
    const d = document.createElement('div');
    d.id = 'log-preview';
    d.style.cssText = 'position:fixed;top:20px;right:20px;background:white;padding:15px;border:2px solid #667eea;border-radius:8px;z-index:9999;font-family:monospace;box-shadow:0 4px 15px rgba(0,0,0,0.1);max-width:400px;word-wrap:break-word;animation:slideIn 0.3s;';
    d.innerHTML = `<strong>Copied!</strong><br/><div style="background:#f5f5f5;padding:5px;margin-top:5px;border-radius:4px;">${text.replace(/\n/g,'<br/>')}</div>`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 4000);
}

function createBtn(text, gradient, onClick) {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = `margin-left:10px;padding:4px 10px;background:${gradient};color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    return b;
}

// ============================================================================
// MAIN LOOP - FINDS BUTTONS & KEYS
// ============================================================================

function scanAndInject() {
    const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    
    // 1. Package Buttons
    document.querySelectorAll('button').forEach(btn => {
        if (btn.textContent.includes('Issue') && !btn.nextElementSibling?.id?.startsWith('pkg-btn')) {
            const b = createBtn('Copy Log', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', (el) => handleClick(el, 'pkg', 1, 'Copy Log', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'));
            b.id = 'pkg-btn-' + Math.random().toString(36).substr(2, 5);
            btn.parentNode.insertBefore(b, btn.nextSibling);
        }
    });

    // 2. Lockout Button (Only on Profile)
    if (/EntryID:|Rez 360/i.test(container.innerText) && !document.getElementById('lockout-btn')) {
        
        // TARGETING STRATEGY: 
        // 1. Priority: "Keys" header (H3 matches your diagnostic report)
        // 2. Fallback: "Loaner Keys Report" header (H2)
        
        const anchors = Array.from(document.querySelectorAll('h3, h2, h4, strong, span'));
        
        const bestAnchor = anchors.find(el => {
            if (el.offsetParent === null) return false; // Must be visible
            const text = el.innerText.trim();
            
            // This specifically targets the "Keys" header found in your diagnostic
            if (text === 'Keys' || text === 'Related') return true;
            if (text.includes('Loaner Keys Report')) return true;
            
            return false;
        });

        if (bestAnchor) {
            const b = createBtn('Copy Lockout', 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', (el) => handleClick(el, 'lockout', 1, 'Copy Lockout', 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'));
            b.id = 'lockout-btn';
            
            // Append button inside the header so it sits next to the text
            bestAnchor.appendChild(b);
            log('Lockout button injected at:', bestAnchor.tagName, bestAnchor.innerText);
        }
    }
    
    // 3. Print Label Button
    const entryAction = Array.from(document.querySelectorAll('button')).find(b => /Entry Actions/i.test(b.textContent));
    if (entryAction && !document.getElementById('label-btn')) {
        const b = createBtn('Print Label', 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', (el) => handleClick(el, 'label', 1, 'Print Label', 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'));
        b.id = 'label-btn';
        entryAction.parentNode.insertBefore(b, entryAction);
    }
}

// Run logic loop
function init() {
    const s = document.createElement('style');
    s.textContent = `@keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
    document.head.appendChild(s);
    
    log('StarRez Logger v3.0 Started');
    setInterval(scanAndInject, CONFIG.RETRY_INTERVAL); 
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
