import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import {
  Home, Briefcase, PenSquare, Bell, User, Copy, Download, Loader2,
  AlertCircle, CheckCircle, Search, Sparkles, Mic, Film, Image as ImageIcon,
  Check, Save, Moon, Sun, Settings, Shield, ChevronRight, BookOpen, Brain,
  Award, Star, ChevronLeft, Trash2, Database, Languages, Link2
} from 'lucide-react';

// --- API Configuration ---
// Kept your original API key
const API_KEY = "AIzaSyAC5fhP8h3-yTk7JmJJaL9q2keQ7gZSMqQ";

// --- API URLs ---
const GEMINI_FLASH_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;
const IMAGEN_URL = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${API_KEY}`;
const TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`;

// --- Local Storage Hook ---
// Replaces Firebase for storing projects
function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue];
}

// --- Theme Context ---
// For managing dark/light mode across the app
const ThemeContext = createContext();

const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useLocalStorage('theme', 'light');

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove(theme === 'light' ? 'dark' : 'light');
    root.classList.add(theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

const useTheme = () => useContext(ThemeContext);

// --- Exponential Backoff Fetch ---
/**
  * A robust fetch wrapper with exponential backoff for API calls.
  * @param {string} url The API endpoint URL.
  * @param {object} options The fetch options (method, headers, body).
  * @param {number} maxRetries Maximum number of retries.
  * @returns {Promise<object>} The JSON response from the API.
  */
async function fetchWithBackoff(url, options, maxRetries = 5) {
  let delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return await response.json();
      }
      if (response.status === 429 || response.status >= 500) {
        // Implement exponential backoff with jitter
        const jitter = Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i) + jitter));
      } else {
        throw new Error(`API request failed with status ${response.status}: ${await response.text()}`);
      }
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const jitter = Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i) + jitter));
    }
  }
  throw new Error("API request failed after maximum retries.");
}

// --- API Call Functions ---
/**
  * Calls the Gemini API for text generation (with optional grounding).
  * @param {string} userQuery The user's prompt.
  * @param {string} systemPrompt The system instruction.
  * @param {boolean} useGrounding Whether to enable Google Search grounding.
  * @returns {Promise<string>} The generated text.
  */
async function callGeminiApi(userQuery, systemPrompt, useGrounding = false) {
  const payload = {
    contents: [{ parts: [{ text: userQuery }] }],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    ...(useGrounding && { tools: [{ "google_search": {} }] })
  };
  const result = await fetchWithBackoff(GEMINI_FLASH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Invalid API response structure from Gemini.");
  }
  return text;
}
/**
  * Calls the Imagen API to generate an image.
  * @param {string} prompt The prompt for image generation.
  * @returns {Promise<string>} The base64 encoded image data.
  */
async function callImagenApi(prompt) {
  const payload = {
    instances: [{ prompt }],
    parameters: { "sampleCount": 1 }
  };
  const result = await fetchWithBackoff(IMAGEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const base64Data = result.predictions?.[0]?.bytesBase64Encoded;
  if (!base64Data) {
    throw new Error("Invalid API response structure from Imagen.");
  }
  return base64Data;
}
/**
  * Calls the TTS API to generate audio.
  * @param {string} text The script to synthesize.
  * @param {string} voiceName The prebuilt voice name (e.g., 'Kore', 'Puck').
  * @returns {Promise<string>} The base64 encoded PCM audio data.
  */
async function callTtsApi(text, voiceName) {
  const payload = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName }
        }
      }
    },
    model: "gemini-2.5-flash-preview-tts"
  };
  const result = await fetchWithBackoff(TTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const part = result?.candidates?.[0]?.content?.parts?.[0];
  const audioData = part?.inlineData?.data;
  const mimeType = part?.inlineData?.mimeType;
  if (!audioData || !mimeType || !mimeType.startsWith("audio/")) {
    throw new Error("Invalid API response structure from TTS.");
  }
  const sampleRateMatch = mimeType.match(/rate=(\d+)/);
  const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 24000;
  return { audioData, sampleRate };
}

// --- Audio Helper Functions ---
function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
function pcmToWav(pcmData, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < pcmData.length; i++, offset += 2) {
    view.setInt16(offset, pcmData[i], true);
  }
  return new Blob([view], { type: 'audio/wav' });
}
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
function cleanApiResponse(text) {
  let cleanedText = text.trim();
  if (cleanedText.startsWith("```json")) {
    cleanedText = cleanedText.substring(7);
  } else if (cleanedText.startsWith("```")) {
    cleanedText = cleanedText.substring(3);
  }
  if (cleanedText.endsWith("```")) {
    cleanedText = cleanedText.substring(0, cleanedText.length - 3);
  }
  return cleanedText.trim();
}

// --- Helper Components ---
const LoadingSpinner = ({ message }) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex flex-col items-center justify-center z-50 p-4">
    <Loader2 className="w-12 h-12 sm:w-16 sm:h-16 text-white animate-spin" />
    <span className="text-white text-base sm:text-lg mt-4 text-center">{message}</span>
  </div>
);
const MessageBox = ({ message, type = 'error' }) => {
  if (!message) return null;
  const isError = type === 'error';
  // Note: Added dark mode classes
  return (
    <div className={`p-3 sm:p-4 rounded-lg ${isError ? 'bg-red-100 border-red-400 text-red-700 dark:bg-red-900 dark:border-red-700 dark:text-red-200' : 'bg-blue-100 border-blue-400 text-blue-700 dark:bg-blue-900 dark:border-blue-700 dark:text-blue-200'}`} role="alert">
      <div className="flex items-center">
        {isError ? <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" /> : <CheckCircle className="w-5 h-5 mr-2 flex-shrink-0" />}
        <span className="font-medium">{isError ? 'Error:' : 'Info:'}</span>
      </div>
      {/* Added break-words to prevent long error messages from overflowing */}
      <p className="ml-7 break-words">{message}</p>
    </div>
  );
};
const CopyableOutput = ({ title, content, rows = 3 }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const tempTextArea = document.createElement('textarea');
    tempTextArea.value = content;
    document.body.appendChild(tempTextArea);
    tempTextArea.select();
    try {
      document.execCommand('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
    document.body.removeChild(tempTextArea);
  };
  // Note: Added dark mode classes
  // *** MODIFIED: Reduced padding from p-3 sm:p-4 to p-3 for a tighter look ***
  return (
    <div className="bg-white rounded-lg shadow-md p-3 space-y-2 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
      <div className="flex justify-between items-center">
        <h3 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-100 break-words">{title}</h3>
        <button
          onClick={handleCopy}
          className={`px-3 py-1 text-sm font-medium rounded-md flex items-center flex-shrink-0 ml-2 ${copied ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'}`}
        >
          {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <textarea
        readOnly
        value={content}
        rows={rows}
        className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 font-mono text-sm dark:bg-gray-900 dark:border-gray-600 dark:text-gray-300"
      />
    </div>
  );
};

// --- Page View Components ---

const HomeView = () => (
  // Added responsive padding
  <div className="p-1 sm:p-4 space-y-6">
    <div className="text-center pt-4">
      {/* Added responsive text sizes */}
      <h1 className="text-4xl sm:text-5xl font-bold text-blue-600 dark:text-blue-400">CSCreate</h1>
      <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-300 mt-2">Kandamas AI-Powered Robot</p>
    </div>
    
    {/* Added responsive padding and overflow-hidden */}
    <div className="p-4 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 mb-3">About CSCreate</h2>
      {/* Added break-words for safety */}
      <p className="text-gray-700 dark:text-gray-300 mb-2 break-words">
        CSCreate is a professional tool developed by <span className="font-semibold">Shridhar Group of Company</span>, 
        designed exclusively for <span className="font-semibold">Kandamas</span> to revolutionize content creation.
      </p>
      <p className="text-gray-700 dark:text-gray-300 break-words">
        Our mission is to empower creators by automating the most time-consuming parts of video production, 
        from viral topic research to final script and thumbnail generation, all powered by cutting-edge AI.
      </p>
    </div>

    <div className="p-4 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
      <h3 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 mb-4">Our Services</h3>
      <ul className="list-disc list-inside space-y-3 text-gray-700 dark:text-gray-300">
        <li className="font-medium">App Development & Play Store Publishing</li>
        <li className="font-medium">Website Development & Hosting</li>
        <li className="font-medium">Amazon/Flipkart Seller Account Setup</li>
        <li className="font-medium">Logo Design & Visiting Cards</li>
        <li className="font-medium">And Many more professional services</li>
      </ul>
      <div className="mt-5 border-t border-gray-200 dark:border-gray-700 pt-4 break-words">
        <p className="text-gray-700 dark:text-gray-300 font-semibold">Email: <span className="font-normal">shridhargroupofcompany2024@gmail.com</span></p>
        <p className="text-gray-700 dark:text-gray-300 font-semibold">Phone: <span className="font-normal">+91 74836 40694</span></p>
      </div>
    </div>

    <div className="text-center text-gray-500 dark:text-gray-400 text-xs pt-4">
      <p className="font-semibold text-sm">CSCreate</p>
      <p>© 2025 Shridhar Group of Company. All rights reserved.</p>
    </div>
  </div>
);

const ProjectsView = ({ projects, setProjects }) => {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Data is loaded via useLocalStorage in the root, just simulate loading
    setTimeout(() => setIsLoading(false), 250);
  }, []);
  
  const sortedProjects = [...projects].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return (
    // p-4 was fine, kept it
    <div className="p-1 sm:p-4">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">My Projects</h1>
      {isLoading && <p className="mt-2 text-gray-600 dark:text-gray-300">Loading projects...</p>}
      {!isLoading && projects.length === 0 && (
        <p className="mt-4 text-gray-600 dark:text-gray-300">You have no saved projects. Create one and save it!</p>
      )}
      <div className="space-y-4 mt-6">
        {sortedProjects.map(project => (
          // Reduced padding, added overflow-hidden
          <div key={project.id} className="p-4 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
            {/* Added break-words to prevent long titles from overflowing */}
            <h2 className="text-lg sm:text-xl font-bold text-blue-600 dark:text-blue-400 break-words">{project.title || "Untitled Project"}</h2>
            <p className="text-base text-gray-700 dark:text-gray-300 mt-1 font-medium break-words">{project.topic}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
              Saved on: {new Date(project.createdAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

const UpdatesView = () => {
  const thoughts = [
    { 
      icon: Brain,
      thought: "Your mind is your greatest asset. Train it, feed it, and protect it." 
    },
    { 
      icon: BookOpen,
      thought: "Every day is a new page. Write a Best. Don't let others hold the pen But we hold the both will hold pen forever." 
    },
    { 
      icon: Sparkles,
      thought: "Success is not final, failure is not End: it is the courage to continue that listening everyday proud,blessed lines by papu devate kandama." 
    },
    { 
      icon: User,
      thought: "Nin Preethi-Motivation-Inspiration enda ne yalla sadya forever Papu devate kandama" 
    }
  ];

  return (
    <div className="p-1 sm:p-4">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-6">Updates & Motivation</h1>
      <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-200 mb-4">Thoughts by Papu Devate Kandama</h2>
      <div className="space-y-5">
        {thoughts.map((item, index) => (
          // Reduced padding, icon size, and margin for mobile
          <div key={index} className="flex items-start p-4 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
            <item.icon className="w-10 h-10 sm:w-12 sm:h-12 text-blue-500 dark:text-blue-400 mr-4 flex-shrink-0" />
            <p className="text-base sm:text-lg text-gray-700 dark:text-gray-300 italic">"{item.thought}"</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- New Profile Page & Sub-Views ---

const ProfileView = ({ mainRef }) => {
  const { theme, toggleTheme } = useTheme();
  // State to manage sub-pages: 'main', 'settings', 'privacy'
  const [profileView, setProfileView] = useState('main');

  // *** FIX: Scroll to top when sub-view changes ***
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTo(0, 0);
    }
  }, [profileView, mainRef]);

  // --- Skill Bar Component with Animation ---
  const SkillBar = ({ skill, targetPercentage, start }) => {
    const [displayedPercentage, setDisplayedPercentage] = useState(0);
    const [isMaxed, setIsMaxed] = useState(false);
    const animationRef = useRef(null);

    useEffect(() => {
      if (!start) {
        setDisplayedPercentage(0);
        setIsMaxed(false);
        return; // Don't start animation if not triggered
      }

      setIsMaxed(false);
      const startTime = Date.now();
      const duration = 1500; // 1.5 seconds animation

      const animate = () => {
        const elapsedTime = Date.now() - startTime;
        const progress = Math.min(elapsedTime / duration, 1);
        const currentPercentage = Math.floor(progress * targetPercentage);
        
        setDisplayedPercentage(currentPercentage);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          setDisplayedPercentage(targetPercentage);
          // Wait 0.3s then show MAX
          setTimeout(() => {
            setIsMaxed(true);
          }, 300); // Changed from 500ms to 300ms
        }
      };

      animationRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, [targetPercentage, start]); // Reruns if start becomes true

    // Responsive bar height
    const barWidth = displayedPercentage / (targetPercentage / 100);

    return (
      <div className="w-full">
        <div className="flex justify-between mb-1 items-center">
          <span className="text-sm sm:text-base font-bold text-blue-700 dark:text-blue-400">{skill}</span>
          {isMaxed ? (
            <span className="text-base sm:text-lg font-bold text-red-600 dark:text-red-500 animate-pulse">MAX</span>
          ) : (
            <span className="text-xs sm:text-sm font-semibold text-blue-700 dark:text-blue-400">{displayedPercentage}%</span>
          )}
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4 sm:h-5 dark:bg-gray-700 overflow-hidden shadow-inner">
          <div 
            className="bg-gradient-to-r from-blue-500 to-purple-600 h-4 sm:h-5 rounded-full transition-all duration-100 ease-linear" 
            style={{ width: `${barWidth}%` }}
          ></div>
        </div>
      </div>
    );
  };

  // --- Badge Component ---
  const Badge = ({ icon: Icon, label }) => (
    // Reduced padding, icon size, and text size
    <div className="flex flex-col items-center p-3 bg-gray-100 dark:bg-gray-900 rounded-lg shadow-inner">
      <div className="p-2 sm:p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full text-white shadow-lg">
        <Icon className="w-6 h-6 sm:w-8 sm:h-8" />
      </div>
      <span className="mt-2 text-sm text-center font-bold text-gray-800 dark:text-gray-200">{label}</span>
    </div>
  );
  
  // --- Reusable List Button ---
  const ProfileButton = ({ icon: Icon, label, onClick }) => (
    <button 
      onClick={onClick}
      // Reduced padding and text size
      className="w-full flex justify-between items-center text-left p-4 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors overflow-hidden"
    >
      <div className="flex items-center">
        <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400 mr-4 flex-shrink-0" />
        <span className="text-gray-700 dark:text-gray-300 font-bold text-base sm:text-lg">{label}</span>
      </div>
      <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
    </button>
  );

  // --- Sub-Page Views ---
  const SettingsPage = () => {
    // *** FIX: Added state for the notification toggle ***
    const [notifications, setNotifications] = useState(true);
    
    return (
      <div className="p-1 sm:p-4">
        {/* Reduced text size and margin */}
        <button onClick={() => setProfileView('main')} className="flex items-center text-blue-600 dark:text-blue-400 font-semibold mb-4 text-base">
          <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6 mr-1" /> Back to Profile
        </button>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-6">Settings</h1>
        
        <div className="space-y-4">
          <ProfileButton icon={Languages} label="Language" onClick={() => {}} />
          <ProfileButton icon={Database} label="Manage Storage" onClick={() => {}} />
          <ProfileButton icon={Trash2} label="Clear Cache" onClick={() => {}} />

          {/* Reduced padding and text size */}
          <div className="p-4 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <Bell className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400 mr-4" />
                  <span className="text-gray-700 dark:text-gray-300 font-bold text-base sm:text-lg">Notifications</span>
                </div>
                <div className="relative inline-block w-11 align-middle select-none transition duration-200 ease-in flex-shrink-0">
                  {/* *** FIX: Made this a controlled component *** */}
                  <input 
                    type="checkbox" 
                    name="toggle" 
                    id="toggle" 
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer dark:bg-gray-900"
                    checked={notifications}
                    onChange={() => setNotifications(prev => !prev)}
                  />
                  <label htmlFor="toggle" className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer dark:bg-gray-600"></label>
                </div>
              </div>
          </div>
          
          <div className="text-center text-gray-500 dark:text-gray-400 text-sm pt-8">
            <p>App Version 1.0.0</p>
          </div>
        </div>
      </div>
    );
  };

  const PrivacyPolicyPage = () => (
    <div className="p-1 sm:p-4">
      <button onClick={() => setProfileView('main')} className="flex items-center text-blue-600 dark:text-blue-400 font-semibold mb-4 text-base">
        <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6 mr-1" /> Back to Profile
      </button>
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-6">Privacy Policy</h1>
      
      {/* Added break-words for all text */}
      <div className="space-y-4 text-gray-700 dark:text-gray-300 break-words">
        <p className="font-semibold">Last updated: 24 June 2005</p>
        <p>Your privacy is important to us. This policy explains how CSCreate handles your information.</p>
        
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 pt-2">Data Collection & Storage</h2>
        <p>CSCreate is designed to be privacy-first. All project data you create, including topics, scripts, and metadata, is stored exclusively on your device's Local Storage. This data never leaves your device and is not sent to any external server or database.</p>
        
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 pt-2">API Services</h2>
        <p>To generate content, the app sends your prompts (like topics or script requirements) to third-party AI models (Google Gemini and Imagen). This interaction is anonymous and no personal data is sent with these requests.</p>
        
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 pt-2">Contact Us</h2>
        <p>If you have any questions about this Privacy Policy, please contact <span className="font-semibold">Shridhar Group of Company</span> at <span className="text-blue-500">shridhargroupofcompany2024@gmail.com</span>.</p>
      </div>
    </div>
  );

  // --- Main Profile View ---
  const MainProfile = () => {
    // State to trigger animation
    const [startAnimation, setStartAnimation] = useState(false);
    
    // Trigger animation when this component mounts (i.e., when user taps Profile tab)
    useEffect(() => {
      setStartAnimation(true);
    }, []);

    return (
      <div className="p-1 sm:p-4">
        {/* Made profile header responsive */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-24 h-24 sm:w-28 sm:h-28 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center shadow-2xl mb-4">
            <span className="text-5xl sm:text-6xl font-bold text-white">CS</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">ChaiShri</h1>
          <p className="text-xl sm:text-2xl text-gray-500 dark:text-gray-400 font-medium">Kandamas</p>
        </div>

        {/* Stats Section */}
        <div className="p-4 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 mb-4 overflow-hidden">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 mb-5 text-center">Qualities</h2>
          <div className="space-y-4">
            <SkillBar skill="Respectful" targetPercentage={1000} start={startAnimation} />
            <SkillBar skill="Character" targetPercentage={1000} start={startAnimation} />
            <SkillBar skill="Intelligent" targetPercentage={1000} start={startAnimation} />
            <SkillBar skill="Clever" targetPercentage={1000} start={startAnimation} />
            <SkillBar skill="Genius" targetPercentage={1000} start={startAnimation} />
          </div>
        </div>

        {/* Badges Section */}
        <div className="p-4 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 mb-4 overflow-hidden">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 mb-5 text-center">Forever Badges</h2>
          <div className="grid grid-cols-2 gap-4">
            <Badge icon={Star} label="Respectful Badge" />
            <Badge icon={Award} label="Multi-Billionaire Badge" />
          </div>
        </div>
        
        {/* Settings & Links Section */}
        <div className="space-y-4">
          
          {/*
          // ===============================================
          //         *** THIS IS THE CODE YOU ADDED ***
          // This is the new <input> and <label> toggle
          // that matches the style you requested.
          // It's already perfectly integrated.
          // ===============================================
          */}
          <div className="p-4 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex justify-between items-center overflow-hidden">
            <div className="flex items-center">
              {theme === 'light' ? 
                <Sun className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400 mr-4" /> : 
                <Moon className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400 mr-4" />}
              <span className="text-gray-700 dark:text-gray-300 font-bold text-base sm:text-lg">Toggle Theme</span>
            </div>
            <div className="relative inline-block w-11 align-middle select-none transition duration-200 ease-in flex-shrink-0">
              <input
                type="checkbox"
                name="theme-toggle"
                id="theme-toggle"
                className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer dark:bg-gray-900"
                checked={theme === 'dark'}
                onChange={toggleTheme}
              />
              <label htmlFor="theme-toggle" className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer dark:bg-gray-600"></label>
            </div>
          </div>
          {/* ===============================================
          //       *** END OF THE TOGGLE SECTION ***
          // ===============================================
          */}

          {/* Settings Button */}
          <ProfileButton icon={Settings} label="Settings" onClick={() => setProfileView('settings')} />
          {/* Privacy Policy Button */}
          <ProfileButton icon={Shield} label="Privacy Policy" onClick={() => setProfileView('privacy')} />
        </div>
      </div>
    );
  }

  // Render the correct view based on state
  switch (profileView) {
    case 'settings':
      return <SettingsPage />;
    case 'privacy':
      return <PrivacyPolicyPage />;
    case 'main':
    default:
      // The re-mount is now handled by the key on <ProfileView> in App.jsx
      return <MainProfile />;
  }
};


// --- Main Workflow Component ---
// UPDATED based on your requests
const CreateView = ({ projects, setProjects }) => { // <-- Now accepts props
  const [step, setStep] = useState('topic'); // topic, topic_select, script_length, script_review, voice_choice, metadata_review, thumbnail
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Working on it...');
  const [errorMessage, setErrorMessage] = useState('');

  // Workflow State
  const [topicQuery, setTopicQuery] = useState('');
  const [suggestedTopics, setSuggestedTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState('');
  const [scriptLength, setScriptLength] = useState('5');
  const [customScriptLength, setCustomScriptLength] = useState('');
  const [generatedScript, setGeneratedScript] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [generatedTitle, setGeneratedTitle] = useState('');
  const [generatedDescription, setGeneratedDescription] = useState('');
  const [generatedHashtags, setGeneratedHashtags] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  
  const metadataFetchedRef = useRef(false);

  // --- API Handlers ---

  const handleError = (error, defaultMessage) => {
    console.error(error);
    setErrorMessage(error.message || defaultMessage);
    setIsLoading(false);
  };

  const handleFetchTopics = async (isSuggestion) => {
    if (!topicQuery && !isSuggestion) {
      setErrorMessage("Please enter a topic to research.");
      return;
    }
    
    setIsLoading(true);
    setLoadingMessage(isSuggestion ? 'Generating viral topics...' : 'Deep researching real-time news...');
    setErrorMessage('');
    
    // NEW: Updated prompt for "Research Topic"
    const systemPrompt = isSuggestion 
      ? "You are a YouTube viral topic expert. Suggest the top 10 most viral-potential YouTube video topics *right now*. Respond with ONLY a valid JSON array of strings. Do not include any other text."
      : "You are a real-time news aggregation bot. The user has provided a topic. Perform a deep Google Search of official portals and news sites to find the TOP 10 *most recent* and *verifiable* breaking news articles. Respond with ONLY a valid JSON array of objects. Each object must have three keys: 'title' (the exact news headline), 'snippet' (a short, 1-2 sentence summary), and 'source_url' (the direct URL to the article for proof). Example: [{\"title\": \"...\", \"snippet\": \"...\", \"source_url\": \"...\"}]";
      
    const userQuery = isSuggestion 
      ? "Suggest top 10 viral topics." 
      : `Research "${topicQuery}" and find 10 real-time news headlines with source URLs.`;
      
    try {
      const text = await callGeminiApi(userQuery, systemPrompt, true); // Use grounding
      const cleanedText = cleanApiResponse(text); // Clean the response
      const topics = JSON.parse(cleanedText); // Parse the cleaned text
      setSuggestedTopics(topics);
      setStep('topic_select');
    } catch (error) {
      handleError(error, "Failed to fetch topics. The API might have returned an invalid format.");
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSelectTopic = (topic) => {
    // If topic is an object (from research), use its title.
    // If it's a string (from suggestions), use it directly.
    const topicTitle = typeof topic === 'object' && topic.title ? topic.title : topic;
    setSelectedTopic(topicTitle);
    setStep('script_length');
  };
  
  const handleGenerateScript = async () => {
    setIsLoading(true);
    setLoadingMessage('Generating your script...');
    setErrorMessage('');
    
    const length = scriptLength === 'custom' ? customScriptLength : scriptLength;
    
    const systemPrompt = "You are a professional YouTube scriptwriter. You write clean, engaging, and concise scripts. The output must be *only* the script text itself, with no timings, 'intro:', 'outro:', speaker names, or any other metadata. Just the spoken words for the voiceover.";
    const userQuery = `Write a ${length}-minute YouTube video script about "${selectedTopic}". Start the script *immediately* with the main content. Do not add any intro, greeting, or channel plugs. Just the main script body.`;
    
    try {
      const scriptBody = await callGeminiApi(userQuery, systemPrompt, false);
      const finalScript = "Welcome Back to Edu Star Youtube channel and If you are first time to our channel Dont forgot to subscribe to our chanel done misss updates and lets start todays video...now today we are talking aboutt... " + scriptBody;
      setGeneratedScript(finalScript);
      setStep('script_review');
    } catch (error) {
      handleError(error, "Failed to generate script.");
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleGenerateVoice = async (gender) => {
    setIsLoading(true);
    setLoadingMessage('Generating AI voice...');
    setErrorMessage('');
  
    // Voices: 'Kore' (firmer, lower), 'Puck' (upbeat, higher)
    const voiceName = gender === 'men' ? 'Kore' : 'Puck'; 
    
    try {
      const { audioData, sampleRate } = await callTtsApi(generatedScript, voiceName);
      const pcmBuffer = base64ToArrayBuffer(audioData);
      const pcm16 = new Int16Array(pcmBuffer);
      const wavBlob = pcmToWav(pcm16, sampleRate);
      const url = URL.createObjectURL(wavBlob);
      setAudioUrl(url);
    } catch (error) {
      handleError(error, "Failed to generate audio.");
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleGenerateMetadata = async () => {
    metadataFetchedRef.current = true; // Mark as fetched
    setIsLoading(true);
    setLoadingMessage('Generating viral metadata...');
    setErrorMessage('');
    
    const systemPrompt = "You are a YouTube SEO expert, specialized in creating viral titles, descriptions, and hashtags. Respond *only* with a valid JSON object with keys: 'title' (string), 'description' (string), 'hashtags' (string). The 'hashtags' value should be a single string of 10+ space-separated hashtags (e.g., '#topic #viral #youtube').";
    const userQuery = `Generate a viral YouTube title, a compelling description, and 10+ high-traffic hashtags for a video about "${selectedTopic}". Use this script summary: "${generatedScript.substring(0, 800)}..."`;
    
    try {
      const text = await callGeminiApi(userQuery, systemPrompt, true); // Use grounding for current trends
      const cleanedText = cleanApiResponse(text); // Clean the response
      const data = JSON.parse(cleanedText); // Parse the cleaned text
      setGeneratedTitle(data.title || '');
      setGeneratedDescription(data.description || '');
      setGeneratedHashtags(data.hashtags || '');
      setStep('metadata_review');
    } catch (error) {
      handleError(error, "Failed to generate metadata. The API might have returned an invalid format.");
    } finally {
      setIsLoading(false);
    }
  };
  
  // Auto-run metadata generation when moving to that step
  useEffect(() => {
    if (step === 'metadata_review' && !metadataFetchedRef.current) {
      handleGenerateMetadata();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  
  const handleSkipToMetadata = () => {
    setAudioUrl(''); // Clear any previously generated audio
    setStep('metadata_review');
  };
  
  const handleGenerateThumbnail = async () => {
    setIsLoading(true);
    setLoadingMessage('Generating 1280x720 thumbnail...');
    setErrorMessage('');
    
    // NEW: Final locked prompt
    const prompt = `Create a realistic, 4K HD, professional YouTube thumbnail for the selected topic ("${selectedTopic}").
The final dimension must be exactly 1280x720 pixels (16:9 aspect ratio).
It MUST include the text "EDUSTAR" as a small, clean logo or watermark.
It must feature compelling, high-quality, realistic, viral-themed imagery related to the topic.
It is forbidden to add any other text besides "EDUSTAR".`;
    
    try {
      const base64Data = await callImagenApi(prompt);
      setThumbnailUrl(`data:image/png;base64,${base64Data}`);
      setStep('thumbnail'); // Move to the final step
    } catch (error) {
      handleError(error, "Failed to generate thumbnail.");
    } finally {
      setIsLoading(false);
   }
  };

  // NEW: Save Project Function
  const handleSaveProject = () => {
    const newProject = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      topic: selectedTopic,
      title: generatedTitle,
      description: generatedDescription,
      hashtags: generatedHashtags,
      script: generatedScript,
      // Note: We don't save audioUrl or thumbnailUrl as they are temporary blobs
    };

    setProjects(prevProjects => [...prevProjects, newProject]);
    
    // Reset all state for a new project
    setStep('topic');
    setTopicQuery('');
    setSuggestedTopics([]);
    setSelectedTopic('');
    setGeneratedScript('');
    setAudioUrl('');
    setGeneratedTitle('');
    setGeneratedDescription('');
    setGeneratedHashtags('');
    setThumbnailUrl('');
    metadataFetchedRef.current = false;
  };

  const renderStep = () => {
    switch (step) {
      case 'topic':
        return (
          // *** FIX: Reduced vertical spacing from space-y-4 to space-y-3 ***
          <div className="space-y-3 p-3 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-100">1. Start with a Topic</h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300">Enter a topic to research, or let us suggest what's trending.</p>
            <div className="relative">
              <input
                type="text"
                value={topicQuery}
                onChange={(e) => setTopicQuery(e.target.value)}
                placeholder="e.g., 'Today's Education news on VTU'"
                className="w-full p-2.5 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm sm:text-base"
              />
              <Search className="absolute w-5 h-5 text-gray-400 left-3 top-1/2 -translate-y-1/2" />
            </div>
            <button
              onClick={() => handleFetchTopics(false)}
              disabled={isLoading}
              className="w-full bg-blue-600 text-white font-semibold py-2.5 px-4 text-sm sm:text-base sm:py-3 rounded-lg shadow-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center"
            >
              <Search className="w-5 h-5 mr-2" />
              Research Topic
            </button>
            <button
              onClick={() => handleFetchTopics(true)}
              disabled={isLoading}
              className="w-full bg-purple-600 text-white font-semibold py-2.5 px-4 text-sm sm:text-base sm:py-3 rounded-lg shadow-md hover:bg-purple-700 disabled:bg-gray-400 flex items-center justify-center"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              Suggest Top 10 Viral Topics
            </button>
          </div>
        );

      case 'topic_select':
        return (
          // *** FIX: Reduced vertical spacing from space-y-4 to space-y-3 ***
          <div className="space-y-3 p-3 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-100">2. Choose Your Topic</h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300">Select one of these AI-generated video ideas.</p>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {suggestedTopics.map((topic, index) => {
                // Check if topic is an object (from research) or a string (from suggestions)
                // NEW: Updated logic to check for source_url
                const isResearchResult = typeof topic === 'object' && topic.title && topic.snippet;
                
                return (
                  <div key={index} className="w-full p-2.5 sm:p-3 bg-white border border-gray-200 rounded-lg shadow-sm transition-all dark:bg-gray-700 dark:border-gray-600">
                    <button
                      onClick={() => handleSelectTopic(topic)}
                      className="w-full text-left"
                    >
                    {isResearchResult ? (
                      <>
                        <span className="font-bold text-base text-blue-700 dark:text-blue-400 break-words">{topic.title}</span>
                        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1 italic break-words">"{topic.snippet}"</p>
                      </>
                    ) : (
                      <span className="font-medium text-base dark:text-gray-200 break-words">{topic}</span>
                    )}
                    </button>
                    {/* NEW: Added Proof link */}
                    {isResearchResult && topic.source_url && (
                      <a
                        href={topic.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} // Prevents topic selection when clicking link
                        className="inline-flex items-center px-3 py-1 mt-3 text-xs font-semibold text-blue-700 bg-blue-100 rounded-full hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800"
                      >
                        <Link2 className="w-3 h-3 mr-1.5" />
                        Proof
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setStep('topic')}
              className="w-full text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              &larr; Back
            </button>
          </div>
        );
        
      case 'script_length':
        return (
          // *** FIX: Reduced vertical spacing from space-y-4 to space-y-3 ***
          <div className="space-y-3 p-3 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-100">3. Set Script Length</h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 font-medium break-words">Topic: <span className="font-normal">{selectedTopic}</span></p>
            {/* *** FIX: Reduced grid gap from gap-3 to gap-2.5 *** */}
            <div className="grid grid-cols-2 gap-2.5">
              {['5', '10', '15', '20'].map(len => (
                <button
                  key={len}
                  onClick={() => setScriptLength(len)}
                  // *** FIX: Added flex, justify-center, items-center to fix alignment ***
                  className={`flex justify-center items-center p-2.5 sm:p-3 rounded-lg border-2 text-sm sm:text-base ${scriptLength === len ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-600'}`}
                >
                  {/* *** FIX: Split number and text for better alignment *** */}
                  <span className="font-bold mr-1.5">{len}</span>
                  <span>Minutes</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setScriptLength('custom')}
              className={`w-full p-2.5 sm:p-3 rounded-lg border-2 text-sm sm:text-base ${scriptLength === 'custom' ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-600'}`}
            >
              Custom
            </button>
            {scriptLength === 'custom' && (
              <input
                type="number"
                value={customScriptLength}
                onChange={(e) => setCustomScriptLength(e.target.value)}
                placeholder="Enter minutes"
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm sm:text-base"
              />
            )}
            <button
              onClick={handleGenerateScript}
              disabled={isLoading || (scriptLength === 'custom' && !customScriptLength)}
              className="w-full bg-blue-600 text-white font-semibold py-2.5 px-4 text-sm sm:text-base sm:py-3 rounded-lg shadow-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center"
            >
              <Film className="w-5 h-5 mr-2" />
              Generate Script
            </button>
              <button
              onClick={() => setStep('topic_select')}
              className="w-full text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              &larr; Back
            </button>
          </div>
        );
        
      case 'script_review':
        return (
          // *** FIX: Reduced vertical spacing from space-y-4 to space-y-3 ***
          <div className="space-y-3 p-3 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-100">4. Review Your Script</h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300">Check the script and make any edits you need.</p>
            <textarea
              value={generatedScript}
              onChange={(e) => setGeneratedScript(e.target.value)}
              rows={10}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:rows-12"
            />
            <h3 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-100">Next Step: AI Voice</h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => handleGenerateVoice('men')}
                disabled={isLoading}
                className="flex-1 bg-cyan-600 text-white font-semibold py-2.5 px-4 text-sm sm:text-base sm:py-3 rounded-lg shadow-md hover:bg-cyan-700 disabled:bg-gray-400 flex items-center justify-center"
              >
                <Mic className="w-5 h-5 mr-2" />
                Generate (Men's Voice)
              </button>
              <button
                onClick={() => handleGenerateVoice('women')}
                disabled={isLoading}
                className="flex-1 bg-pink-600 text-white font-semibold py-2.5 px-4 text-sm sm:text-base sm:py-3 rounded-lg shadow-md hover:bg-pink-700 disabled:bg-gray-400 flex items-center justify-center"
              >
                <Mic className="w-5 h-5 mr-2" />
                Generate (Women's Voice)
              </button>
            </div>
            {audioUrl && (
              <div className="space-y-2 p-3 bg-gray-50 rounded-lg border dark:bg-gray-700 dark:border-gray-600">
                <audio controls src={audioUrl} className="w-full">
                  Your browser does not support the audio element.
                </audio>
                <a
                  href={audioUrl}
                  download="generated_audio.wav"
                  className="w-full text-center block bg-green-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-700 flex items-center justify-center"
                >
                  <Download className="w-5 h-5 mr-2" />
                  Download Audio
                </a>
              </div>
            )}
            <button
              onClick={handleSkipToMetadata}
              className="w-full bg-blue-600 text-white font-semibold py-2.5 px-4 text-sm sm:text-base sm:py-3 rounded-lg shadow-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {audioUrl ? 'Next: Generate Metadata' : 'Skip & Generate Metadata'}
            </button>
              <button
              onClick={() => setStep('script_length')}
              className="w-full text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              &larr; Back
            </button>
          </div>
        );
        
      case 'metadata_review':
        return (
          // *** FIX: Reduced vertical spacing from space-y-4 to space-y-3 ***
          <div className="space-y-3 p-3 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-100">5. Viral Metadata</h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300">Here's your title, description, and hashtags. Copy them easily!</p>
            <CopyableOutput title="Viral YouTube Title" content={generatedTitle} rows={2} />
            <CopyableOutput title="Viral Description" content={generatedDescription} rows={6} />
            <CopyableOutput title="10M+ Viral Hashtags" content={generatedHashtags} rows={3} />
            <button
              onClick={handleGenerateThumbnail}
              disabled={isLoading}
              className="w-full bg-blue-600 text-white font-semibold py-2.5 px-4 text-sm sm:text-base sm:py-3 rounded-lg shadow-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center"
            >
              <ImageIcon className="w-5 h-5 mr-2" />
              Generate Thumbnail
            </button>
              <button
              onClick={() => setStep('script_review')}
              className="w-full text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              &larr; Back
            </button>
          </div>
        );
        
      case 'thumbnail':
        return (
          // *** FIX: Reduced vertical spacing from space-y-4 to space-y-3 ***
          <div className="space-y-3 p-3 bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-100">6. Your Thumbnail</h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300">Generated at 1280x720 (YouTube's standard 16:9 ratio).</p>
            {thumbnailUrl && (
              // This container is perfect for responsiveness, no changes needed
              <div className="w-full aspect-[16/9] rounded-lg shadow-lg overflow-hidden border border-gray-300 dark:border-gray-600">
                <img src={thumbnailUrl} alt="Generated Thumbnail" className="w-full h-full object-cover" />
              </div>
            )}
            <button
              onClick={handleGenerateThumbnail}
              disabled={isLoading}
              className="w-full bg-blue-600 text-white font-semibold py-2.5 px-4 text-sm sm:text-base sm:py-3 rounded-lg shadow-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center"
            >
              <ImageIcon className="w-5 h-5 mr-2" />
              Generate Another One
            </button>
            {/* NEW: Download Button */}
            <a
              href={thumbnailUrl}
              download="generated_thumbnail.png"
              className={`w-full bg-green-600 text-white font-semibold py-2.5 px-4 text-sm sm:text-base sm:py-3 rounded-lg shadow-md hover:bg-green-700 flex items-center justify-center ${!thumbnailUrl ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <Download className="w-5 h-5 mr-2" />
              Download Thumbnail
            </a>
            <button
              onClick={handleSaveProject} // NEW: Changed to save project
              className="w-full bg-purple-600 text-white font-semibold py-2.5 px-4 text-sm sm:text-base sm:py-3 rounded-lg shadow-md hover:bg-purple-700"
            >
              <Save className="w-5 h-5 mr-2" />
              Save Project & Start New
            </button>
              <button
              onClick={() => setStep('metadata_review')}
              className="w-full text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              &larr; Back
            </button>
          </div>
        );

      default:
        return <div>Invalid step.</div>;
    }
  };

  return (
    // Tightened max-width for a better feel on tablets
    <div className="w-full max-w-xl mx-auto space-y-4">
      {isLoading && <LoadingSpinner message={loadingMessage} />}
      <MessageBox message={errorMessage} type="error" />
      {renderStep()}
    </div>
  );
};


// --- Bottom Navigation ---

const BottomNavBar = ({ activeTab, setActiveTab }) => {
  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'projects', label: 'Projects', icon: Briefcase },
    { id: 'create', label: 'Create', icon: PenSquare },
    { id: 'updates', label: 'Updates', icon: Bell }, // Changed from notifications
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    // Reduced height from h-20 to h-16
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-200 shadow-t-2xl pb-safe z-10 dark:bg-gray-900 dark:border-gray-700">
      <div className="max-w-md mx-auto h-full flex justify-around items-center">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            data-active={(activeTab === item.id).toString()}
            className="flex flex-col items-center justify-center w-full h-full text-gray-500 data-[active=true]:text-blue-600 dark:text-gray-400 dark:data-[active=true]:text-blue-400 transition-colors group"
          >
            {/* Reduced icon size from w-7 h-7 to w-6 h-6 */}
            <div className={`p-2 sm:p-3 rounded-full ${activeTab === item.id ? 'bg-blue-100 dark:bg-blue-900' : 'group-hover:bg-gray-100 dark:group-hover:bg-gray-800'}`}>
              <item.icon className="w-6 h-6" />
            </div>
            {/* Made text smaller */}
            <span className="text-xs font-bold mt-0.5">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};

// FIX: renderView moved outside of App to be accessible globally (or passed down)
// *** FIX: Added mainRef to signature ***
const renderView = (activeTab, projects, setProjects, mainRef) => {
    switch (activeTab) {
      case 'home':
        return <HomeView key="home" />;
      case 'projects':
        return <ProjectsView key="projects" projects={projects} setProjects={setProjects} />;
      case 'create':
        // CHANGED: Pass projects state to CreateView
        return <CreateView key="create" projects={projects} setProjects={setProjects} />;
      case 'updates':
        return <UpdatesView key="updates" />;
      case 'profile':
        // *** FIX: Pass mainRef to ProfileView ***
        return <ProfileView key={`profile-${Date.now()}`} mainRef={mainRef} />;
      default:
        return <HomeView key="home" />;
    }
  };


// --- Root App Component ---

export default function App() {
  const [activeTab, setActiveTab] = useState('create');
  // Load projects from local storage
  const [projects, setProjects] = useLocalStorage('cscreate_projects', []);
  
  // *** FIX: Ref for scrolling to top ***
  const mainRef = useRef(null);
  
  // *** FIX: Scroll to top when activeTab changes ***
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTo(0, 0);
    }
  }, [activeTab]);

  return (
    <ThemeProvider>
      {/* Using Inter font for a pro look */}
      <div className="flex flex-col h-screen bg-gray-100 font-inter dark:bg-gray-950">
        {/* *** FIX: Added ref and adjusted padding ***
          Reduced padding-bottom from pb-24 to pb-20 (to match new h-16 nav)
          Reduced horizontal padding from p-4 to p-3, with sm:p-4 for larger screens
        */}
        <main ref={mainRef} className="flex-1 overflow-y-auto p-3 sm:p-4 pt-safe pb-20">
          {/* *** FIX: Pass mainRef to renderView *** */}
          {renderView(activeTab, projects, setProjects, mainRef)}
        </main>
        <BottomNavBar activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>
      
      {/* This is the global style for the theme toggle, exactly as you provided. */}
      <style>{`
        .toggle-checkbox:checked {
          transform: translateX(1.25rem); /* Move the handle for toggle */
          border-color: #3b82f6; /* blue-600 */
        }
        .toggle-checkbox:checked + .toggle-label {
          background-color: #3b82f6; /* blue-600 */
        }
        .dark .toggle-checkbox:checked {
          border-color: #60a5fa; /* blue-400 */
        }
        .dark .toggle-checkbox:checked + .toggle-label {
          background-color: #60a5fa; /* blue-400 */
        }
        /* Basic styles for the toggle switch */
        .toggle-checkbox {
          transition: all 0.2s ease-in-out;
          left: 0;
        }
      `}</style>
    </ThemeProvider>
  );
}