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
    // VALIDATION
    // ========================================================================
    const isValid = data.fullName && data.studentNumber && data.roomSpace;
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
                error: 'Could not extract student data. Check console for details.' 
            };
        }
        
        if (!studentData.fullName) {
            return { success: false, error: 'Student name not found' };
        }
        
        if (!studentData.studentNumber) {
            return { success: false, error: 'Student number not found' };
        }
        
        if (!studentData.roomSpace) {
            return { success: false, error: 'Room/bedspace not found' };
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
        background: white;
        border: 2px solid #667eea;
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        z-index: 10000;
        max-width: 500px;
        font-family: monospace;
        font-size: 13px;
        animation: slideIn 0.3s ease;
    `;
    
    const staffInfo = data.staffName ? `<div style="font-size: 11px; color: #999; margin-bottom: 4px;">Logged by: ${data.staffName}</div>` : '';
    const debugInfo = `<div style="font-size: 10px; color: #ccc; margin-top: 8px;">Student: ${data.fullName}<br/>Room: ${data.roomSpace}</div>`;
    
    preview.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 8px; color: #667eea;">✓ Copied to Clipboard</div>
        ${staffInfo}
        <div style="background: #f7f7f7; padding: 8px; border-radius: 4px; word-break: break-all; font-weight: 600;">${text}</div>
        ${debugInfo}
    `;
    
    document.body.appendChild(preview);
    
    setTimeout(() => {
        preview.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => preview.remove(), 300);
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
                        masterButton.textContent = '✓ Copied!';
                        masterButton.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
                        
                        showPreview(result.logEntry, result.data);
                        
                        setTimeout(() => {
                            masterButton.textContent = originalText;
                            masterButton.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
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
                    const originalText = logButton.textContent;
                    logButton.textContent = '✓ Copied!';
                    logButton.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
                    
                    showPreview(result.logEntry, result.data);
                    
                    setTimeout(() => {
                        logButton.textContent = originalText;
                        logButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
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
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
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
