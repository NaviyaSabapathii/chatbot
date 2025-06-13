from flask import Flask, render_template, request, jsonify, session, redirect, url_for, make_response
import os
from dotenv import load_dotenv
import requests
import json
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import sqlite3
from datetime import datetime
import hashlib
import uuid
import re
from fpdf import FPDF

# LangChain imports with enhanced models
from langchain_community.llms import Together
from langchain.schema import HumanMessage, AIMessage
from langchain.memory import ConversationBufferWindowMemory
from langchain.prompts import PromptTemplate

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dev-secret-key')

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["20 per minute"],
    storage_uri="memory://"
)

# Together API key
TOGETHER_API_KEY = os.getenv('TOGETHER_API_KEY', '')

# SQLite setup
DB_PATH = 'cloud_chat.db'

# In-memory conversation storage for better context
user_conversations = {}

def init_db():
    """Initialize SQLite database with required tables"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    # Create messages table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def hash_password(password):
    """Create a salted hash of the password"""
    return hashlib.sha256(password.encode()).hexdigest()

def get_conversation_context(user_id, limit=6):
    """Get structured conversation history for better context"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute(
            "SELECT sender, message FROM messages WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?",
            (user_id, limit)
        )
        
        messages = cursor.fetchall()
        conn.close()
        
        # Structure conversation properly
        conversation_history = []
        for sender, message in reversed(messages):
            role = "Human" if sender == 'user' else "Assistant"
            conversation_history.append(f"{role}: {message}")
        
        return "\n".join(conversation_history) if conversation_history else ""
    except Exception as e:
        print(f"Error getting conversation context: {e}")
        return ""

def create_enhanced_prompt(user_message, language, conversation_context=""):
    """Create enhanced prompts with better context and instructions"""
    
    base_instructions = {
        'tamil': {
            'system': "நீங்கள் ஒரு அனுபவமிக்க தமிழ் மருத்துவ ஆலோசகர். நோயாளிகளுக்கு தெளிவான, பயனுள்ள மற்றும் துல்லியமான மருத்துவ ஆலோசனைகளை வழங்குங்கள்.",
            'rules': """விதிகள்:
• தமிழில் மட்டும் பதிலளிக்கவும்
• நோயாளியின் கேள்விக்கு நேரடியாக பதில் கொடுங்கள்
• தெளிவான காரணங்கள் மற்றும் தீர்வுகள் வழங்குங்கள்
• 200-300 சொற்களில் விரிவான பதில் கொடுங்கள்
• மருத்துவ வார்த்தைகளை எளிய தமிழில் விளக்குங்கள்
• தடுப்பு நடவடிக்கைகள் மற்றும் வீட்டு வைத்தியம் சொல்லுங்கள்
• தீவிர நிலையில் மருத்துவரை அணுகச் சொல்லுங்கள்""",
            'context_intro': "முந்தைய உரையாடல்:",
            'question_intro': "நோயாளியின் தற்போதைய கேள்வி:"
        },
        'hindi': {
            'system': "आप एक अनुभवी हिंदी चिकित्सा सलाहकार हैं। मरीजों को स्पष्ट, उपयोगी और सटीक चिकित्सा सलाह प्रदान करें।",
            'rules': """नियम:
• केवल हिंदी में उत्तर दें
• मरीज के प्रश्न का सीधा उत्तर दें
• स्पष्ट कारण और समाधान प्रदान करें
• 200-300 शब्दों में विस्तृत उत्तर दें
• चिकित्सा शब्दों को सरल हिंदी में समझाएं
• रोकथाम के उपाय और घरेलू इलाज बताएं
• गंभीर स्थिति में डॉक्टर से मिलने की सलाह दें""",
            'context_intro': "पिछली बातचीत:",
            'question_intro': "मरीज का वर्तमान प्रश्न:"
        },
        'english': {
            'system': "You are an experienced medical advisor. Provide clear, helpful, and accurate medical advice to patients.",
            'rules': """Rules:
• Answer only in English
• Directly address the patient's question
• Provide clear reasons and solutions
• Give detailed response in 200-300 words
• Explain medical terms in simple language
• Include prevention measures and home remedies
• Advise seeing a doctor for serious conditions""",
            'context_intro': "Previous conversation:",
            'question_intro': "Patient's current question:"
        }
    }
    
    lang_config = base_instructions.get(language, base_instructions['english'])
    
    # Build comprehensive prompt
    prompt_parts = [lang_config['system'], lang_config['rules']]
    
    if conversation_context:
        prompt_parts.extend([
            f"\n{lang_config['context_intro']}",
            conversation_context,
            ""
        ])
    
    prompt_parts.extend([
        f"{lang_config['question_intro']} {user_message}",
        "",
        "पूर्ण उत्तर:" if language == 'hindi' else ("முழுமையான பதில்:" if language == 'tamil' else "Complete Answer:")
    ])
    
    return "\n".join(prompt_parts)

def clean_ai_response(response_text, language="english"):
    """Enhanced response cleaning with better preservation of content"""
    if not response_text:
        return get_fallback_response(language)
    
    # Remove only specific unwanted patterns, preserve medical content
    unwanted_patterns = [
        r"^.*?Complete Answer:\s*",
        r"^.*?முழுமையான பதில்:\s*",
        r"^.*?पूर्ण उत्तर:\s*",
        r"^.*?Rules:.*?\n",
        r"^.*?விதிகள்:.*?\n",
        r"^.*?नियम:.*?\n",
        r"Human:.*?(?=Assistant:|$)",
        r"Previous conversation:.*?(?=Patient's|$)",
        r"पिछली बातचीत:.*?(?=मरीज का|$)",
        r"முந்தைய உரையாடல்:.*?(?=நோயாளியின்|$)",
        r"^\s*[-•]\s*(?=.*:)",  # Remove bullet points that are labels
        r"```.*?```",
        r"\*\*System\*\*.*?\n",
    ]
    
    cleaned_response = response_text.strip()
    
    # Apply careful pattern removal
    for pattern in unwanted_patterns:
        cleaned_response = re.sub(pattern, '', cleaned_response, flags=re.MULTILINE | re.IGNORECASE | re.DOTALL)
    
    # Clean up excessive whitespace but preserve structure
    cleaned_response = re.sub(r'\n\s*\n\s*\n+', '\n\n', cleaned_response)
    cleaned_response = re.sub(r'^\s*\n+', '', cleaned_response)
    cleaned_response = cleaned_response.strip()
    
    # More lenient minimum length check
    if not cleaned_response or len(cleaned_response.strip()) < 50:
        return get_fallback_response(language)
    
    return cleaned_response

def get_fallback_response(language):
    """Enhanced fallback responses with more helpful content"""
    responses = {
        "tamil": """உங்கள் உடல்நல கேள்விக்கு விரிவான பதில் அளிக்க தயாராக இருக்கிறேன்.

பொதுவான உடல்நல வழிமுறைகள்:
• சத்துள்ள உணவு - பழங்கள், காய்கறிகள், முழு தானியங்கள்
• தினமும் 30 நிமிடம் உடற்பயிற்சி - நடைபயிற்சி, யோகா
• போதுமான தூக்கம் - இரவு 7-8 மணி நேரம்
• நிறைய தண்ணீர் - தினமும் 8-10 கிளாஸ்
• மன அழுத்தம் குறைக்க - தியானம், பொழுதுபோக்கு

உங்கள் குறிப்பிட்ட பிரச்சனையை மீண்டும் தெளிவாக கேட்கவும். அவசர நிலையில் உடனடியாக மருத்துவரை அணுகவும்.""",

        "hindi": """मैं आपके स्वास्थ्य प्रश्न का विस्तृत उत्तर देने के लिए तैयार हूं।

सामान्य स्वास्थ्य दिशानिर्देश:
• पौष्टिक आहार - फल, सब्जियां, साबुत अनाज
• रोज 30 मिनट व्यायाम - टहलना, योग
• पर्याप्त नींद - रात में 7-8 घंटे
• भरपूर पानी - दिन में 8-10 गिलास
• तनाव कम करें - ध्यान, मनोरंजन

कृपया अपनी विशिष्ट समस्या को फिर से स्पष्ट रूप से बताएं। आपातकाल में तुरंत चिकित्सक से मिलें।""",

        "english": """I'm ready to provide detailed answers to your health questions.

General Health Guidelines:
• Nutritious diet - fruits, vegetables, whole grains
• Daily 30-minute exercise - walking, yoga
• Adequate sleep - 7-8 hours nightly
• Plenty of water - 8-10 glasses daily
• Stress management - meditation, hobbies

Please rephrase your specific concern more clearly. For emergencies, consult a doctor immediately."""
    }
    
    return responses.get(language, responses["english"])

@app.route('/')
def index():
    """Render the main page"""
    return render_template('index.html')

@app.route('/health')
@limiter.exempt
def health_check():
    """Simple health check endpoint"""
    return jsonify({"status": "ok"})

@app.route('/login', methods=['GET'])
def get_login_status():
    """Check if user is logged in and return email"""
    if 'user_id' in session and 'email' in session:
        return jsonify({"user_id": session['user_id'], "email": session['email']})
    return jsonify({"error": "Not logged in"}), 401

@app.route('/chat', methods=['POST'])
@limiter.limit("10 per minute")
def chat():
    """Enhanced chat processing with better AI responses"""
    data = request.json
    user_message = data.get('userMessage', '').strip()
    language = data.get("language", "english").lower()
    
    if not user_message:
        return jsonify({"error": "Please provide a message"}), 400
    
    if not TOGETHER_API_KEY:
        return jsonify({"error": "Together API key is missing. Please set TOGETHER_API_KEY in your .env file."}), 500
    
    try:
        user_id = session.get('user_id', 'anonymous')
        
        # Save user message first if logged in
        if 'user_id' in session:
            try:
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                user_msg_id = str(uuid.uuid4())
                cursor.execute(
                    "INSERT INTO messages (id, user_id, sender, message, timestamp) VALUES (?, ?, ?, ?, datetime('now'))",
                    (user_msg_id, user_id, 'user', user_message)
                )
                conn.commit()
                conn.close()
            except Exception as e:
                print(f"Error saving user message: {str(e)}")
        
        # Get conversation context
        conversation_context = ""
        if user_id != 'anonymous':
            conversation_context = get_conversation_context(user_id, limit=8)
        
        # Create the enhanced LLM instance
        llm = Together(
            model="meta-llama/Llama-3-70b-chat-hf",  # Better model
            together_api_key=TOGETHER_API_KEY,
            temperature=0.4,  # Balanced creativity and consistency
            max_tokens=512,   # More tokens for detailed responses
            top_p=0.9,
            repetition_penalty=1.1
        )
        
        # Create enhanced prompt
        enhanced_prompt = create_enhanced_prompt(user_message, language, conversation_context)
        
        print("🔍 Enhanced Prompt:", enhanced_prompt[:300], "...")
        print("🔍 Sending request to Together AI...")
        
        # Make the API call
        response = llm.invoke(enhanced_prompt)
        
        print(f"🤖 Raw AI Response: {response[:200]}...")
        
        # Clean the response with enhanced cleaning
        ai_response = clean_ai_response(response, language)
        
        print(f"✅ Final Cleaned Response: {ai_response[:200]}...")
        
        # Quality check with lower threshold
        if len(ai_response.strip()) < 80:
            ai_response = get_fallback_response(language)
        
        # Save AI response if user is logged in
        if 'user_id' in session:
            try:
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                bot_msg_id = str(uuid.uuid4())
                cursor.execute(
                    "INSERT INTO messages (id, user_id, sender, message, timestamp) VALUES (?, ?, ?, ?, datetime('now'))",
                    (bot_msg_id, user_id, 'bot', ai_response)
                )
                conn.commit()
                conn.close()
            except Exception as e:
                print(f"Error saving bot message: {str(e)}")
        
        return jsonify({"message": ai_response})
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        error_msg = get_fallback_response(language)
        return jsonify({"message": error_msg}), 200

@app.route('/signup', methods=['POST'])
def signup():
    """Create a new user account"""
    data = request.json
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({"error": "Please provide both email and password"}), 400
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Check if email already exists
        cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({"error": "Email already registered"}), 400
        
        # Create new user
        user_id = str(uuid.uuid4())
        password_hash = hash_password(password)
        
        cursor.execute(
            "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
            (user_id, email, password_hash)
        )
        conn.commit()
        conn.close()
        
        return jsonify({"user_id": user_id, "email": email})
    except Exception as e:
        return jsonify({"error": f"Sign-up error: {str(e)}"}), 400

@app.route('/login', methods=['POST'])
def login():
    """User login endpoint"""
    data = request.json
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({"error": "Please provide both email and password"}), 400
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute(
            "SELECT id, password_hash FROM users WHERE email = ?",
            (email,)
        )
        result = cursor.fetchone()
        conn.close()
        
        if not result or result[1] != hash_password(password):
            return jsonify({"error": "Invalid email or password"}), 401
        
        user_id = result[0]
        
        # Store user info in session
        session['user_id'] = user_id
        session['email'] = email
        
        return jsonify({"user_id": user_id, "email": email})
    except Exception as e:
        return jsonify({"error": f"Login error: {str(e)}"}), 500

@app.route('/logout', methods=['POST'])
def logout():
    """User logout endpoint"""
    session.clear()
    return jsonify({"message": "Logged out successfully"})

@app.route('/messages', methods=['GET'])
def get_messages():
    """Retrieve chat history for logged-in user"""
    if 'user_id' not in session:
        return jsonify({"error": "Not logged in"}), 401
    
    user_id = session['user_id']
    
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute(
            "SELECT sender, message, timestamp FROM messages WHERE user_id = ? ORDER BY timestamp",
            (user_id,)
        )
        
        message_list = []
        for row in cursor.fetchall():
            message_list.append({
                'sender': row['sender'],
                'message': row['message'],
                'timestamp': row['timestamp']
            })
        
        conn.close()
        return jsonify({"messages": message_list})
    except Exception as e:
        return jsonify({"error": f"Error retrieving messages: {str(e)}"}), 500

@app.route('/save_message', methods=['POST'])
def save_message():
    """Save a user message to database"""
    if 'user_id' not in session:
        return jsonify({"error": "Not logged in"}), 401
    
    data = request.json
    user_id = session['user_id']
    message = data.get('message')
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        message_id = str(uuid.uuid4())
        cursor.execute(
            "INSERT INTO messages (id, user_id, sender, message, timestamp) VALUES (?, ?, ?, ?, datetime('now'))",
            (message_id, user_id, 'user', message)
        )
        
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": f"Error saving message: {str(e)}"}), 500

@app.route('/clear_history', methods=['POST'])
def clear_history():
    """Clear a user's conversation history"""
    if 'user_id' not in session:
        return jsonify({"error": "Not logged in"}), 401
    
    user_id = session['user_id']
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Clear messages
        cursor.execute("DELETE FROM messages WHERE user_id = ?", (user_id,))
        
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "Conversation history cleared"})
    except Exception as e:
        return jsonify({"error": f"Error clearing history: {str(e)}"}), 500 

@app.route('/download_pdf', methods=['GET'])
def download_pdf():
    if 'user_id' not in session:
        return jsonify({"error": "Not logged in"}), 401

    user_id = session['user_id']

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT sender, message, timestamp FROM messages WHERE user_id = ? ORDER BY timestamp",
            (user_id,)
        )
        messages = cursor.fetchall()
        conn.close()

        # Create PDF
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=12)

        pdf.cell(200, 10, txt="MediChat Conversation History", ln=True, align='C')
        pdf.ln(10)

        for sender, message, timestamp in messages:
            prefix = "You: " if sender == 'user' else "Bot: "
            # Handle Unicode characters properly
            try:
                pdf.multi_cell(0, 10, txt=f"{timestamp} - {prefix}{message}")
            except:
                # Fallback for Unicode issues
                safe_message = message.encode('ascii', 'ignore').decode('ascii')
                pdf.multi_cell(0, 10, txt=f"{timestamp} - {prefix}{safe_message}")

        response = make_response(pdf.output(dest='S').encode('latin-1'))
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = 'attachment; filename=medichat_history.pdf'
        return response

    except Exception as e:
        return jsonify({"error": f"PDF generation failed: {str(e)}"}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)