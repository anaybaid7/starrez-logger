// StarRez Package Logger - Content Script
// Pierces Shadow DOM and automates package log formatting

// Extract staff member's name from Pendo initialization script
function getStaffName() {
  // Look for the Pendo initialization script
  const scripts = document.querySelectorAll('script');
  
  for (let script of scripts) {
    const scriptText = script.textContent;
    
    // Look for the pendo.initialize call with visitor info
    if (scriptText.includes('pendo.initialize') && scriptText.includes('full_name')) {
      // Extract the full_name value using regex
      const fullNameMatch = scriptText.match(/full_name:\s*`([^`]+)`/);
      
      if (fullNameMatch && fullNameMatch[1]) {
        return fullNameMatch[1]; // Returns "Anay Baid"
      }
    }
  }
  
  console.warn('Could not find staff name in Pendo script');
  return null;
}

// Shadow DOM Piercer - recursively searches through shadow roots
function findInShadowDOM(selector, root = document) {
  // Try normal querySelector first
  let element = root.querySelector(selector);
  if (element) return element;
  
  // Search through all shadow roots
  const allElements = root.querySelectorAll('*');
  for (let el of allElements) {
    if (el.shadowRoot) {
      element = findInShadowDOM(selector, el.shadowRoot);
      if (element) return element;
    }
  }
  return null;
}

// Get all text from shadow DOM element
function getTextFromShadowElement(selector) {
  const element = findInShadowDOM(selector);
  return element ? element.textContent.trim() : null;
}

// Extract student data from breadcrumb (name and record ID)
function getStudentDataFromBreadcrumb() {
  const breadcrumbs = document.querySelectorAll('habitat-header-breadcrumb-item');
  
  for (let crumb of breadcrumbs) {
    const moduleAttr = crumb.getAttribute('module');
    if (moduleAttr) {
      try {
        const moduleData = JSON.parse(moduleAttr);
        if (moduleData.dbObjectName === 'Entry' && moduleData.recordId) {
          // Get the text content (student name)
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

// Extract data from table cells with data-label
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
  // Handle "Last, First" format (for students like "Pennings, Joel")
  if (fullName.includes(',')) {
    const parts = fullName.split(',').map(p => p.trim());
    const lastName = parts[0];
    const firstName = parts[1] || '';
    
    // Get first letter of each part of first name and first letter of last name
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
  hours = hours ? hours : 12; // 0 should be 12
  
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  
  return `${hours}:${minutesStr} ${ampm}`;
}

// Generate the log entry
function generateLogEntry() {
  try {
    // Get staff name and initials from Pendo script
    const staffName = getStaffName();
    const staffInitials = staffName ? getInitials(staffName) : 'XX';
    
    if (!staffName) {
      console.warn('Could not detect staff name from Pendo. Using XX as placeholder.');
    }
    
    // Get student data from breadcrumb
    const studentData = getStudentDataFromBreadcrumb();
    if (!studentData) {
      return { success: false, error: 'Could not find student data in breadcrumb' };
    }
    
    // Try to get student number and room from active table
    let studentNumber = getTableData('Student Number');
    let roomSpace = getTableData('Room Space Description') || getTableData('Bed Space');
    
    // If not in table, try other locations
    if (!studentNumber) {
      studentNumber = studentData.recordId; // Fallback to record ID
    }
    
    if (!roomSpace) {
      return { success: false, error: 'Could not find room/bed space information' };
    }
    
    // Get initials from student name
    const initials = getInitials(studentData.fullName);
    
    // Get current time
    const time = getCurrentTime();
    
    // Default to 1 package - user can edit if needed
    const packageCount = 1;
    
    // Format: AC (21138571) CLVN-338a 1 pkg @ 12:20 pm - AD
    const logEntry = `${initials} (${studentNumber}) ${roomSpace} ${packageCount} pkg${packageCount > 1 ? 's' : ''} @ ${time} - ${staffInitials}`;
    
    return {
      success: true,
      logEntry: logEntry,
      data: {
        initials,
        studentNumber,
        roomSpace,
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
    console.error('Failed to copy:', err);
    return false;
  }
}

// Create and inject the custom button
function createLogButton() {
  // Look for existing Issue button or suitable location
  const issueButtons = document.querySelectorAll('button, input[type="button"], a.button');
  
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
        // Show success feedback
        const originalText = logButton.textContent;
        logButton.textContent = 'Copied!';
        logButton.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
        
        // Show preview
        showPreview(result.logEntry, result.data.staffName);
        
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
      alert('Error generating log entry: ' + result.error);
    }
  });
  
  // Insert button next to Issue button
  targetButton.parentNode.insertBefore(logButton, targetButton.nextSibling);
}

// Show preview popup
function showPreview(text, staffName) {
  // Remove existing preview if any
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
  
  const staffInfo = staffName ? `<div style="font-size: 11px; color: #999; margin-bottom: 4px;">Logged by: ${staffName}</div>` : '';
  
  preview.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 8px; color: #667eea;">Copied to Clipboard:</div>
    ${staffInfo}
    <div style="background: #f7f7f7; padding: 8px; border-radius: 4px; word-break: break-all;">${text}</div>
  `;
  
  document.body.appendChild(preview);
  
  // Auto-remove after 4 seconds
  setTimeout(() => {
    preview.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => preview.remove(), 300);
  }, 4000);
}

// Add animation styles
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
`;
document.head.appendChild(style);

// Initialize - run when page loads and on DOM changes
function initialize() {
  createLogButton();
}

// Run on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Watch for dynamic content changes (StarRez uses AJAX)
const observer = new MutationObserver(() => {
  initialize();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

console.log('StarRez Package Logger extension loaded!');
