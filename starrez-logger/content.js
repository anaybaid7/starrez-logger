// ============================================================================
// StarRez Package Logger - PRODUCTION READY v2.0
// Supports: CLV, MKV, REV, UWP, V1
// ============================================================================

const CONFIG = {
    DEBUG: true, // Set to false in production
    RESIDENCE_PATTERNS: [
        // Supports ALL formats including digits in residence codes:
        // - Standard: MHR-323a, UWP-456b
        // - With digits: V1-W2-311a (V1 has digit!)
        // - N/S suffix: CLVN-349b, CLVS-039a  
        // - E-buildings: REV-E4-455a, REV-EA-204b, MKV-A3-789c
        /[A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z]/i
    ]
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function log(...args) {
    if (CONFIG.DEBUG) console.log('[PKG-LOGGER]', ...args);
}

function error(...args) {
    console.error('[PKG-LOGGER ERROR]', ...args);
}

// ============================================================================
// STAFF NAME EXTRACTION
// ============================================================================

function getStaffName() {
    const scripts = document.querySelectorAll('script');
    for (let script of scripts) {
        const scriptText = script.textContent;
        if (scriptText.includes('pendo.initialize') && scriptText.includes('full_name')) {
            const fullNameMatch = scriptText.match(/full_name:\s*`([^`]+)`/);
            if (fullNameMatch && fullNameMatch[1]) {
                log('Staff name found:', fullNameMatch[1]);
                return fullNameMatch[1];
            }
        }
    }
    error('Staff name not found in Pendo script');
    return null;
}

// ============================================================================
// INITIALS GENERATION - FIXED FOR "LastName, FirstName" FORMAT
// ============================================================================

function getInitials(fullName) {
    if (!fullName) return 'X.X';
    
    // Handle "LastName, FirstName" format (StarRez standard)
    if (fullName.includes(',')) {
        const parts = fullName.split(',').map(p => p.trim());
        const lastName = parts[0];
        const firstName = parts[1] || '';
        
        log(`Parsing name: "${fullName}" -> Last: "${lastName}", First: "${firstName}"`);
        
        // Get first initials from first name(s)
        const firstInitials = firstName
            .split(/\s+/)
            .filter(n => n.length > 0)
            .map(n => n[0].toUpperCase())
            .join('');
        
        // Get first initials from last name(s)
        const lastInitials = lastName
            .split(/\s+/)
            .filter(n => n.length > 0)
            .map(n => n[0].toUpperCase())
            .join('');
        
        const result = `${firstInitials}.${lastInitials}`;
        log(`Initials generated: ${result}`);
        return result;
    }
    
    // Fallback for non-standard format
    const nameParts = fullName.split(/\s+/).filter(p => p.length > 0);
    if (nameParts.length >= 2) {
        const firstInitials = nameParts.slice(0, -1).map(n => n[0].toUpperCase()).join('');
        const lastInitial = nameParts[nameParts.length - 1][0].toUpperCase();
        return `${firstInitials}.${lastInitial}`;
    }
    
    return nameParts.map(p => p[0]).join('').toUpperCase() + '.X';
}

// ============================================================================
// STUDENT DATA EXTRACTION - ROBUST WITH MULTIPLE FALLBACKS
// ============================================================================

function getStudentDataFromRez360() {
    const data = {};
    
    // Find the active detail container
    let detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    let containerText = detailContainer.innerText;
    
    // CRITICAL FIX: Isolate ONLY the Rez 360 detail section (after "EntryID:")
    // This prevents grabbing data from dashboard tables (Loaner Keys, Parcels, etc.)
    const entryIdIndex = containerText.indexOf('EntryID:');
    if (entryIdIndex !== -1) {
        containerText = containerText.substring(entryIdIndex);
        log('✓ Isolated Rez 360 section (starts at EntryID)');
    } else {
        log('⚠ Could not find EntryID marker, using full container');
    }
    
    log('Container text length:', containerText.length);
    
    // ========================================================================
    // 1. EXTRACT STUDENT NAME (from breadcrumb - most reliable)
    // ========================================================================
    const breadcrumbs = detailContainer.querySelectorAll('habitat-header-breadcrumb-item');
    for (let crumb of breadcrumbs) {
        const text = crumb.textContent.trim();
        // Must have comma, exclude navigation items
        if (text.includes(',') && 
            !text.includes('Dashboard') && 
            !text.includes('Desk') && 
            !text.includes('Front')) {
            data.fullName = text;
            log('✓ Name found in breadcrumb:', text);
            break;
        }
    }
    
    if (!data.fullName) {
        error('✗ Could not find student name in breadcrumbs');
    }
    
    // ========================================================================
    // 2. EXTRACT STUDENT NUMBER
    // ========================================================================
    const studentNumMatch = containerText.match(/Student Number\s+(\d{8})/);
    if (studentNumMatch) {
        data.studentNumber = studentNumMatch[1];
        log('✓ Student number found:', data.studentNumber);
    } else {
        error('✗ Could not find student number');
    }
    
    // ========================================================================
    // 3. EXTRACT BEDSPACE - MULTIPLE METHODS WITH FALLBACKS
    // ========================================================================
    
    // METHOD 1: Look for "Room\n\nBEDSPACE/BEDSPACE" pattern (most reliable for Rez 360 view)
    // Supports: CLVN-349b/CLVN-349b, REV-E4-455a/REV-E4-455a, V1-W2-311a/V1-W2-311a
    const roomSlashPattern = /Room\s+([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])\/([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])/i;
    let roomMatch = containerText.match(roomSlashPattern);
    
    if (roomMatch) {
        // Take the bedspace AFTER the slash (second capture group)
        data.roomSpace = roomMatch[2];
        log('✓ METHOD 1: Bedspace found (after slash):', data.roomSpace);
    }
    
    // METHOD 2: Look for standalone bedspace pattern in Rez 360 section
    if (!data.roomSpace) {
        const rez360Section = containerText.match(/Rez 360[\s\S]*?(?=Activity|Related|$)/);
        if (rez360Section) {
            for (let pattern of CONFIG.RESIDENCE_PATTERNS) {
                const match = rez360Section[0].match(pattern);
                if (match) {
                    data.roomSpace = match[0];
                    log('✓ METHOD 2: Bedspace found in Rez 360 section:', data.roomSpace);
                    break;
                }
            }
        }
    }
    
    // METHOD 3: Look for "Room Space" in contract/booking table
    if (!data.roomSpace) {
        const roomSpacePattern = /Room Space[\s\S]*?([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])/i;
        roomMatch = containerText.match(roomSpacePattern);
        if (roomMatch) {
            data.roomSpace = roomMatch[1];
            log('✓ METHOD 3: Bedspace found in Room Space field:', data.roomSpace);
        }
    }
    
    // METHOD 4: Search entire container for any valid bedspace pattern
    if (!data.roomSpace) {
        for (let pattern of CONFIG.RESIDENCE_PATTERNS) {
            const matches = containerText.match(new RegExp(pattern.source, 'gi'));
            if (matches && matches.length > 0) {
                // Take the LAST match (most recent/relevant)
                data.roomSpace = matches[matches.length - 1];
                log('✓ METHOD 4: Bedspace found via pattern search:', data.roomSpace);
                break;
            }
        }
    }
    
    if (!data.roomSpace) {
        error('✗ Could not find bedspace with any method');
        log('Available room text snippets:', containerText.match(/Room[^\n]{0,100}/gi));
    }
    
    // ========================================================================
    // VALIDATION - SECURITY & COMPLIANCE CHECKS
    // ========================================================================
    
    // Check all required fields exist
    const hasAllFields = data.fullName && data.studentNumber && data.roomSpace;
    
    // Validate student number format (must be 8 digits)
    const validStudentNum = /^\d{8}$/.test(data.studentNumber);
    
    // Validate bedspace format (must match known patterns)
    const validBedspace = /^[A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z]$/i.test(data.roomSpace);
    
    // Validate name format (must have comma for "LastName, FirstName")
    const validName = data.fullName && data.fullName.includes(',');
    
    const isValid = hasAllFields && validStudentNum && validBedspace && validName;
    
    if (!isValid) {
        error('❌ VALIDATION FAILED:');
        error('  - All fields present:', hasAllFields);
        error('  - Valid student number:', validStudentNum, `(${data.studentNumber})`);
        error('  - Valid bedspace:', validBedspace, `(${data.roomSpace})`);
        error('  - Valid name format:', validName, `(${data.fullName})`);
    } else {
        log('✅ All validation checks passed');
    }
    
    log('Extraction complete:', { isValid, data });
    
    return isValid ? data : null;
}

// ============================================================================
// TIME FORMATTING
// ============================================================================

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

// ============================================================================
// LOG ENTRY GENERATION
// ============================================================================

function generateLogEntry(packageCount = 1) {
    try {
        const staffName = getStaffName();
        const staffInitials = staffName ? getInitials(staffName) : 'X.X';
        
        const studentData = getStudentDataFromRez360();
        
        if (!studentData) {
            return { 
                success: false, 
                error: 'Data extraction failed. Check console logs for details.',
                validationDetails: 'One or more required fields could not be extracted or failed validation.'
            };
        }
        
        if (!studentData.fullName) {
            return { success: false, error: 'Student name not found in breadcrumbs' };
        }
        
        if (!studentData.studentNumber) {
            return { success: false, error: 'Student number not found (must be 8 digits)' };
        }
        
        if (!studentData.roomSpace) {
            return { success: false, error: 'Bedspace not found (check format: XXX-###x)' };
        }
        
        const initials = getInitials(studentData.fullName);
        const time = getCurrentTime();
        
        // Format: J.D (20321232) CLVN-349b 1 pkg @ 1:39 am - A.B
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} ${packageCount} pkg${packageCount > 1 ? 's' : ''} @ ${time} - ${staffInitials}`;
        
        log('Generated log entry:', logEntry);
        
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
    } catch (err) {
        error('Exception in generateLogEntry:', err);
        return { success: false, error: err.message };
    }
}

// ============================================================================
// CLIPBOARD OPERATIONS
// ============================================================================

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        log('Copied to clipboard:', text);
        return true;
    } catch (err) {
        error('Clipboard copy failed:', err);
        return false;
    }
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

function createStyledButton(text, gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', isMaster = false) {
    const button = document.createElement('button');
    button.className = 'pkg-logger-btn';
    
    // Create inner glow effect
    const glowSpan = document.createElement('span');
    glowSpan.className = 'pkg-logger-btn-glow';
    
    // Create text container
    const textSpan = document.createElement('span');
    textSpan.className = 'pkg-logger-btn-text';
    textSpan.textContent = text;
    
    button.appendChild(glowSpan);
    button.appendChild(textSpan);
    
    // Base styles
    const baseSize = isMaster ? '10px 24px' : '8px 18px';
    const baseFontSize = isMaster ? '15px' : '14px';
    
    button.style.cssText = `
        position: relative;
        margin-left: ${isMaster ? '15px' : '10px'};
        padding: ${baseSize};
        background: ${gradient};
        background-size: 200% 200%;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 700;
        font-size: ${baseFontSize};
        letter-spacing: 0.5px;
        text-transform: uppercase;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(102, 126, 234, 0.4);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        overflow: hidden;
        vertical-align: middle;
        animation: gradientShift 3s ease infinite;
    `;
    
    // Glow effect styles
    glowSpan.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 70%);
        transform: translate(-50%, -50%) scale(0);
        border-radius: 50%;
        transition: transform 0.5s ease;
        pointer-events: none;
    `;
    
    // Text styles
    textSpan.style.cssText = `
        position: relative;
        z-index: 1;
        display: inline-block;
        transition: transform 0.2s ease;
    `;
    
    // Hover effect
    button.addEventListener('mouseenter', () => {
        button.style.transform = 'translateY(-3px) scale(1.05)';
        button.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.25), 0 4px 15px rgba(102, 126, 234, 0.6)';
        glowSpan.style.transform = 'translate(-50%, -50%) scale(1.5)';
        textSpan.style.transform = 'scale(1.05)';
    });
    
    button.addEventListener('mouseleave', () => {
        button.style.transform = 'translateY(0) scale(1)';
        button.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(102, 126, 234, 0.4)';
        glowSpan.style.transform = 'translate(-50%, -50%) scale(0)';
        textSpan.style.transform = 'scale(1)';
    });
    
    // Active/click effect
    button.addEventListener('mousedown', () => {
        button.style.transform = 'translateY(-1px) scale(0.98)';
        createRipple(button, event);
    });
    
    button.addEventListener('mouseup', () => {
        button.style.transform = 'translateY(-3px) scale(1.05)';
    });
    
    return button;
}

// Create ripple effect on click
function createRipple(button, event) {
    const ripple = document.createElement('span');
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;
    
    ripple.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.6);
        left: ${x}px;
        top: ${y}px;
        transform: scale(0);
        animation: rippleEffect 0.6s ease-out;
        pointer-events: none;
        z-index: 0;
    `;
    
    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
}

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

function showPreview(text, data) {
    const existing = document.getElementById('log-preview-popup');
    if (existing) existing.remove();
    
    const preview = document.createElement('div');
    preview.id = 'log-preview-popup';
    preview.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #ffffff 0%, #f8f9ff 100%);
        border: 2px solid transparent;
        background-clip: padding-box;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15), 0 4px 20px rgba(102, 126, 234, 0.2);
        z-index: 10000;
        max-width: 500px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        animation: slideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(10px);
    `;
    
    // Add gradient border effect
    preview.style.position = 'relative';
    preview.style.background = 'white';
    preview.style.border = 'none';
    
    const borderGradient = document.createElement('div');
    borderGradient.style.cssText = `
        position: absolute;
        top: -2px;
        left: -2px;
        right: -2px;
        bottom: -2px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
        border-radius: 12px;
        z-index: -1;
        animation: gradientShift 3s ease infinite;
        background-size: 200% 200%;
    `;
    preview.appendChild(borderGradient);
    
    const staffInfo = data.staffName ? `<div style="font-size: 11px; color: #666; margin-bottom: 8px; font-weight: 500;">📋 Logged by: ${data.staffName}</div>` : '';
    const debugInfo = `<div style="font-size: 10px; color: #999; margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee;">👤 Student: ${data.fullName}<br/>🏠 Room: ${data.roomSpace}</div>`;
    
    const content = document.createElement('div');
    content.style.cssText = 'position: relative; z-index: 1;';
    content.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 10px; color: #667eea; font-size: 14px; display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">✓</span>
            <span>Copied to Clipboard</span>
        </div>
        ${staffInfo}
        <div style="background: linear-gradient(135deg, #f7f7ff 0%, #f0f0ff 100%); padding: 12px; border-radius: 8px; word-break: break-all; font-weight: 600; font-family: 'Monaco', 'Menlo', 'Consolas', monospace; font-size: 13px; color: #333; border: 1px solid #e0e0ff;">${text}</div>
        ${debugInfo}
    `;
    preview.appendChild(content);
    
    document.body.appendChild(preview);
    
    setTimeout(() => {
        preview.style.animation = 'slideOut 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        setTimeout(() => preview.remove(), 400);
    }, 4000);
}

// ============================================================================
// BUTTON INJECTION
// ============================================================================

function createLogButtons() {
    // Find all Issue buttons
    const issueButtons = Array.from(document.querySelectorAll('button, input[type="button"], a.button, a[class*="button"]')).filter(btn => {
        const text = btn.textContent.toLowerCase();
        return text.includes('issue') && !text.includes('reissue');
    });
    
    if (issueButtons.length === 0) {
        log('No Issue buttons found on page');
        return;
    }
    
    const packageCount = issueButtons.length;
    log(`Found ${packageCount} Issue button(s)`);
    
    // MASTER BUTTON: For 2+ packages, add button next to "X Parcels" text
    if (packageCount >= 2) {
        const parcelCountElement = findParcelCountElement();
        
        if (parcelCountElement && !document.getElementById('package-log-master-btn')) {
            const masterButton = createStyledButton(
                `Copy ${packageCount} pkgs`,
                'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                true // isMaster flag
            );
            masterButton.id = 'package-log-master-btn';
            
            masterButton.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const result = generateLogEntry(packageCount);
                
                if (result.success) {
                    const copied = await copyToClipboard(result.logEntry);
                    
                    if (copied) {
                        const originalText = masterButton.querySelector('.pkg-logger-btn-text').textContent;
                        const textSpan = masterButton.querySelector('.pkg-logger-btn-text');
                        textSpan.textContent = '✓ Copied!';
                        masterButton.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
                        masterButton.style.animation = 'successPulse 0.5s ease';
                        
                        showPreview(result.logEntry, result.data);
                        
                        setTimeout(() => {
                            textSpan.textContent = originalText;
                            masterButton.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
                            masterButton.style.animation = 'gradientShift 3s ease infinite';
                        }, 2000);
                    }
                } else {
                    alert('❌ Error: ' + result.error);
                }
            });
            
            parcelCountElement.parentNode.insertBefore(masterButton, parcelCountElement.nextSibling);
            log('Master button created for', packageCount, 'packages');
        }
    }
    
    // INDIVIDUAL BUTTONS: Add "Copy Log" next to each Issue button
    issueButtons.forEach((issueBtn, index) => {
        const buttonId = `package-log-btn-${index}`;
        
        if (document.getElementById(buttonId)) {
            return; // Already exists
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
                    const originalText = logButton.querySelector('.pkg-logger-btn-text').textContent;
                    const textSpan = logButton.querySelector('.pkg-logger-btn-text');
                    textSpan.textContent = '✓ Copied!';
                    logButton.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
                    logButton.style.animation = 'successPulse 0.5s ease';
                    
                    showPreview(result.logEntry, result.data);
                    
                    setTimeout(() => {
                        textSpan.textContent = originalText;
                        logButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                        logButton.style.animation = 'gradientShift 3s ease infinite';
                    }, 2000);
                }
            } else {
                alert('❌ Error: ' + result.error);
            }
        });
        
        issueBtn.parentNode.insertBefore(logButton, issueBtn.nextSibling);
    });
    
    log('Individual buttons created');
}

// ============================================================================
// ANIMATION STYLES
// ============================================================================

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { 
            transform: translateX(400px); 
            opacity: 0; 
        }
        to { 
            transform: translateX(0); 
            opacity: 1; 
        }
    }
    
    @keyframes slideOut {
        from { 
            transform: translateX(0); 
            opacity: 1; 
        }
        to { 
            transform: translateX(400px); 
            opacity: 0; 
        }
    }
    
    @keyframes gradientShift {
        0% {
            background-position: 0% 50%;
        }
        50% {
            background-position: 100% 50%;
        }
        100% {
            background-position: 0% 50%;
        }
    }
    
    @keyframes rippleEffect {
        0% {
            transform: scale(0);
            opacity: 1;
        }
        100% {
            transform: scale(4);
            opacity: 0;
        }
    }
    
    @keyframes successPulse {
        0%, 100% {
            transform: scale(1);
        }
        50% {
            transform: scale(1.1);
        }
    }
    
    .pkg-logger-btn {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    }
    
    .pkg-logger-btn:active {
        transform: translateY(-1px) scale(0.98) !important;
    }
`;
document.head.appendChild(style);

// ============================================================================
// INITIALIZATION
// ============================================================================

function initialize() {
    log('Initializing Package Logger...');
    createLogButtons();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Watch for DOM changes (e.g., navigating between students)
const observer = new MutationObserver(() => initialize());
observer.observe(document.body, { childList: true, subtree: true });

log('✓ StarRez Package Logger v2.0 loaded successfully!');
