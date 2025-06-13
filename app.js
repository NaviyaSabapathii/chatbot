// DOM Elements
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const chatMessages = document.getElementById('chat');
const statusIndicator = document.getElementById('status-indicator');
const authStatus = document.getElementById('auth-status');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const signupButton = document.getElementById('signup-button');
const loginButton = document.getElementById('login-button');
const logoutButton = document.getElementById('logout-button');
const clearHistoryButton = document.getElementById('clear-history-button');
const downloadPdfButton = document.getElementById('download-pdf-button');

// App State
let isConnected = false;
let isLoggedIn = false;
let currentUser = null;
let chatHistory = [];

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  setupEventListeners();
});



const languageSelect = document.getElementById('language-select');

// Load language preference
const storedLanguage = localStorage.getItem('medichat_lang') || 'english';
languageSelect.value = storedLanguage;

// Save on change
languageSelect.addEventListener('change', () => {
localStorage.setItem('medichat_lang', languageSelect.value);
});

// Initialize application
function initializeApp() {
  checkServerHealth();
  checkLoginStatus();
  setupAutoResize();
  loadStoredData();
  
  // Set up periodic health check
  setInterval(checkServerHealth, 30000);
}

// Setup all event listeners
function setupEventListeners() {
  // Chat functionality
  sendButton.addEventListener('click', sendMessage);

  messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  // Voice typing button
  const voiceButton = document.getElementById('voice-button');
  if (voiceButton) {
    voiceButton.addEventListener('click', startVoiceTyping);
  }

  // Auth functionality
  signupButton.addEventListener('click', signUp);
  loginButton.addEventListener('click', login);
  logoutButton.addEventListener('click', logout);

  // Additional functionality
  if (clearHistoryButton) {
    clearHistoryButton.addEventListener('click', clearHistory);
  }

  if (downloadPdfButton) {
    downloadPdfButton.addEventListener('click', downloadChatPDF);
  }
}

// Auto-resize textarea functionality
function setupAutoResize() {
  messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });
}

// Check server health and connection status
async function checkServerHealth() {
  try {
    const response = await fetch('/health');
    const isHealthy = response.ok;
    isConnected = isHealthy;
    updateConnectionStatus(isHealthy);
  } catch (error) {
    console.error('Health check failed:', error);
    isConnected = false;
    updateConnectionStatus(false);
  }
}

// Update connection status indicator
function updateConnectionStatus(connected) {
  if (connected) {
    statusIndicator.classList.add('connected');
    statusIndicator.classList.remove('disconnected');
    statusIndicator.title = 'Connected to server';
  } else {
    statusIndicator.classList.remove('connected');
    statusIndicator.classList.add('disconnected');
    statusIndicator.title = 'Disconnected from server';
  }
}

// Check if user is already logged in
async function checkLoginStatus() {
  try {
    const response = await fetch('/login');
    if (response.ok) {
      const userData = await response.json();
      currentUser = userData;
      isLoggedIn = true;
      updateAuthUI();
      await loadChatHistory();
    }
  } catch (error) {
    console.error('Error checking login status:', error);
  }
}

// Load stored chat data (fallback for non-logged in users)
function loadStoredData() {
  if (!isLoggedIn) {
    const storedHistory = sessionStorage.getItem('medichat_history');
    if (storedHistory) {
      try {
        chatHistory = JSON.parse(storedHistory);
      } catch (error) {
        console.error('Error parsing stored chat history:', error);
        chatHistory = [];
      }
    }
  }
}

// Save chat data (fallback for non-logged in users)
function saveStoredData() {
  if (!isLoggedIn) {
    sessionStorage.setItem('medichat_history', JSON.stringify(chatHistory));
  }
}

// Sign up new user
async function signUp() {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  
  if (!email || !password) {
    showNotification('Please enter both email and password', 'error');
    return;
  }
  
  if (!isValidEmail(email)) {
    showNotification('Please enter a valid email address', 'error');
    return;
  }
  
  if (password.length < 6) {
    showNotification('Password must be at least 6 characters long', 'error');
    return;
  }
  
  try {
    showLoadingState(signupButton, 'Creating Account...');
    
    const response = await fetch('/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create account');
    }
    
    // Auto-login after signup
    currentUser = data;
    isLoggedIn = true;
    
    updateAuthUI();
    clearAuthInputs();
    showNotification('Account created successfully!', 'success');
    addMessage('Welcome to MediChat! Your account has been created successfully.', 'system-message');
    
  } catch (error) {
    console.error('Signup error:', error);
    showNotification(error.message || 'Failed to create account', 'error');
  } finally {
    hideLoadingState(signupButton, 'Create Account');
  }
}

// Login existing user
async function login() {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  
  if (!email || !password) {
    showNotification('Please enter both email and password', 'error');
    return;
  }
  
  try {
    showLoadingState(loginButton, 'Signing In...');
    
    const response = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to sign in');
    }
    
    currentUser = data;
    isLoggedIn = true;
    
    updateAuthUI();
    clearAuthInputs();
    await loadChatHistory();
    showNotification('Successfully signed in!', 'success');
    addMessage('Welcome back! How can I help you today?', 'system-message');
    
  } catch (error) {
    console.error('Login error:', error);
    showNotification(error.message || 'Failed to sign in', 'error');
  } finally {
    hideLoadingState(loginButton, 'Sign In');
  }
}

// Logout user
async function logout() {
  try {
    await fetch('/logout', { method: 'POST' });
  } catch (error) {
    console.error('Logout error:', error);
  }
  
  currentUser = null;
  isLoggedIn = false;
  chatHistory = [];
  
  updateAuthUI();
  clearChatHistory();
  showNotification('Successfully signed out', 'success');
  
  // Reset to initial state
  const welcomeMessage = `
    <div class="message bot-message">
      <div class="message-avatar">
        <i class="fas fa-robot"></i>
      </div>
      <div class="message-content">
        Hello! I'm your AI healthcare assistant. How can I help you today?
        <span class="timestamp">Now</span>
      </div>
    </div>
  `;
  chatMessages.innerHTML = welcomeMessage;
}

// Update authentication UI
function updateAuthUI() {
  if (isLoggedIn && currentUser) {
    authStatus.textContent = `Logged in as ${currentUser.email}`;
    authStatus.style.borderLeft = '3px solid var(--success-gradient)';
    
    // Hide auth inputs and login buttons
    emailInput.style.display = 'none';
    passwordInput.style.display = 'none';
    signupButton.style.display = 'none';
    loginButton.style.display = 'none';
    
    // Show logout and other buttons
    logoutButton.style.display = 'block';
    clearHistoryButton.style.display = 'block';
    downloadPdfButton.style.display = 'block';
  } else {
    authStatus.textContent = 'Not logged in';
    authStatus.style.borderLeft = '3px solid var(--danger-gradient)';
    
    // Show auth inputs and login buttons
    emailInput.style.display = 'block';
    passwordInput.style.display = 'block';
    signupButton.style.display = 'block';
    loginButton.style.display = 'block';
    
    // Hide logout and other buttons
    logoutButton.style.display = 'none';
    clearHistoryButton.style.display = 'none';
    downloadPdfButton.style.display = 'none';
  }
}

// Clear authentication input fields
function clearAuthInputs() {
  emailInput.value = '';
  passwordInput.value = '';
}

// Load chat history for logged in users
async function loadChatHistory() {
  if (!isLoggedIn) return;
  
  try {
    const response = await fetch('/messages');
    if (response.ok) {
      const data = await response.json();
      const messages = data.messages || [];
      
      // Clear existing messages except the welcome message
      const welcomeMessage = chatMessages.firstElementChild;
      chatMessages.innerHTML = '';
      if (welcomeMessage) {
        chatMessages.appendChild(welcomeMessage);
      }
      
      // Add messages from history
      messages.forEach((msg, index) => {
        setTimeout(() => {
          const messageType = msg.sender === 'user' ? 'user-message' : 'bot-message';
          addMessage(msg.message, messageType, msg.timestamp);
        }, index * 100);
      });
      
      // Scroll to bottom after all messages are loaded
      setTimeout(() => {
        scrollToBottom();
      }, messages.length * 100 + 200);
    }
  } catch (error) {
    console.error('Error loading chat history:', error);
  }
}

// Send message
async function sendMessage() {
  const message = messageInput.value.trim();
  
  if (!message) return;
  
  if (!isConnected) {
    showNotification('No connection to server. Please try again later.', 'error');
    return;
  }
  
  // Add user message to chat
  addMessage(message, 'user-message');
  
  // Store in history for non-logged users
  if (!isLoggedIn) {
    const userMsg = {
      message: message,
      type: 'user-message',
      timestamp: new Date().toISOString()
    };
    chatHistory.push(userMsg);
    saveStoredData();
  }
  
  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';
  
  // Show typing indicator
  showTypingIndicator();
  
  try {
    // **THIS IS THE KEY CHANGE** - Call the actual Flask API instead of simulation
    const botResponse = await getBotResponse(message);
    
    // Remove typing indicator
    hideTypingIndicator();
    
    // Add bot response
    addMessage(botResponse, 'bot-message');
    
    // Store in history for non-logged users
    if (!isLoggedIn) {
      const botMsg = {
        message: botResponse,
        type: 'bot-message',
        timestamp: new Date().toISOString()
      };
      chatHistory.push(botMsg);
      saveStoredData();
    }
    
  } catch (error) {
    console.error('Error getting bot response:', error);
    hideTypingIndicator();
    addMessage('Sorry, I encountered an error. Please try again.', 'error-message');
  }
}

// **FIXED FUNCTION** - Get bot response from Flask API instead of simulation
async function getBotResponse(userMessage) {
  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userMessage: userMessage,
      language: localStorage.getItem('medichat_lang') || 'english' 
       })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get response');
    }
    
    const data = await response.json();
    return data.message || 'Sorry, I could not process your request.';
    
  } catch (error) {
    console.error('Error calling chat API:', error);
    throw error;
  }
}

// Add a message to the chat window
function addMessage(text, messageClass, timestamp = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${messageClass}`;
  
  // Create avatar for user and bot messages
  if (!messageClass.includes('system') && !messageClass.includes('error')) {
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    
    if (messageClass.includes('user')) {
      avatarDiv.innerHTML = '<i class="fas fa-user"></i>';
    } else if (messageClass.includes('bot')) {
      avatarDiv.innerHTML = '<i class="fas fa-robot"></i>';
    }
    
    messageDiv.appendChild(avatarDiv);
  }

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = text;

  // Add timestamp
  const timestampSpan = document.createElement('span');
  timestampSpan.className = 'timestamp';
  const now = timestamp ? new Date(timestamp) : new Date();
  timestampSpan.textContent = now.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  contentDiv.appendChild(timestampSpan);

  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  
  // Smooth scroll to bottom
  setTimeout(scrollToBottom, 100);
}

// Smooth scroll to bottom of chat
function scrollToBottom() {
  chatMessages.scrollTo({
    top: chatMessages.scrollHeight,
    behavior: 'smooth'
  });
}

// Show typing indicator
function showTypingIndicator() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message bot-message typing-indicator';
  typingDiv.id = 'typing-indicator';

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'message-avatar';
  avatarDiv.innerHTML = '<i class="fas fa-robot"></i>';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = '<i class="fas fa-circle"></i> <i class="fas fa-circle"></i> <i class="fas fa-circle"></i> AI is thinking...';

  typingDiv.appendChild(avatarDiv);
  typingDiv.appendChild(contentDiv);
  chatMessages.appendChild(typingDiv);
  
  scrollToBottom();
}

// Hide typing indicator
function hideTypingIndicator() {
  const typingIndicator = document.getElementById('typing-indicator');
  if (typingIndicator) {
    typingIndicator.remove();
  }
}

// Clear chat history
async function clearHistory() {
  if (confirm('Are you sure you want to clear your chat history? This action cannot be undone.')) {
    try {
      if (isLoggedIn) {
        const response = await fetch('/clear_history', { method: 'POST' });
        if (!response.ok) {
          throw new Error('Failed to clear server history');
        }
      } else {
        chatHistory = [];
        saveStoredData();
      }
      
      clearChatHistory();
      showNotification('Chat history cleared successfully', 'success');
    } catch (error) {
      console.error('Error clearing history:', error);
      showNotification('Failed to clear chat history', 'error');
    }
  }
}

// Clear chat history from UI
function clearChatHistory() {
  // Keep only the welcome message
  const welcomeMessage = `
    <div class="message bot-message">
      <div class="message-avatar">
        <i class="fas fa-robot"></i>
      </div>
      <div class="message-content">
        Hello! I'm your AI healthcare assistant. How can I help you today?
        <span class="timestamp">Now</span>
      </div>
    </div>
  `;
  chatMessages.innerHTML = welcomeMessage;
}

// Download chat as PDF
async function downloadChatPDF() {
  try {
    if (isLoggedIn) {
      // Use server endpoint for logged-in users
      const response = await fetch('/download_pdf');
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `medichat-conversation-${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showNotification('Chat history downloaded successfully', 'success');
      } else {
        throw new Error('Failed to download PDF');
      }
    } else {
      // Fallback for non-logged users
      if (chatHistory.length === 0) {
        showNotification('No chat history to download', 'error');
        return;
      }
      
      // Create a simple text version of the chat
      let chatText = 'MediChat Conversation History\n';
      chatText += '================================\n\n';
      
      chatHistory.forEach(msg => {
        const sender = msg.type.includes('user') ? 'You' : 'MediChat';
        const timestamp = new Date(msg.timestamp).toLocaleString();
        chatText += `[${timestamp}] ${sender}: ${msg.message}\n\n`;
      });
      
      // Create and download as text file
      const blob = new Blob([chatText], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `medichat-conversation-${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      showNotification('Chat history downloaded successfully', 'success');
    }
  } catch (error) {
    console.error('Error downloading chat history:', error);
    showNotification('Failed to download chat history', 'error');
  }
}

// Show notification
function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 1000;
    animation: slideInRight 0.3s ease-out;
    max-width: 300px;
    word-wrap: break-word;
  `;
  
  // Set background color based on type
  switch (type) {
    case 'success':
      notification.style.background = 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
      break;
    case 'error':
      notification.style.background = 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)';
      break;
    default:
      notification.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  }
  
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Auto remove after 3 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease-out';
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// Show loading state for buttons
function showLoadingState(button, text) {
  button.disabled = true;
  button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
}

// Hide loading state for buttons
function hideLoadingState(button, originalText) {
  button.disabled = false;
  button.innerHTML = originalText;
}

// Validate email format
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Add CSS for notifications
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOutRight {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(notificationStyles);

function startVoiceTyping() {
  if (!('webkitSpeechRecognition' in window)) {
    showNotification('Voice recognition not supported in this browser.', 'error');
    return;
  }

  const recognition = new webkitSpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    showNotification('Listening... Speak your message.');
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event);
    showNotification('Speech recognition error. Please try again.', 'error');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    messageInput.value = transcript;
    messageInput.focus();
  };

  recognition.start();
}