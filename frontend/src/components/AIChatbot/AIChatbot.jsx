import React, { useState, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { addToCart } from "../../app/features/cart/cartSlice";
import "./AIChatbot.css";

const BASE_URL = process.env.REACT_APP_API_URL || "https://final-project1-d3iz.onrender.com";

const DEFAULT_SUGGESTIONS = [
  "🔥 Top deals under ₹999",
  "👕 Suggest stylish casual shirts",
  "🎁 Gift ideas for family & friends",
  "🚚 What is your return & delivery policy?",
];

const AIChatbot = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      text: "👋 Hi there! I'm **Nilex AI**, your personal shopping assistant. Ask me anything or tap the 🎙️ **Microphone** to speak your command!",
      products: [],
      followUps: DEFAULT_SUGGESTIONS,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // Voice States
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speechSupported, setSpeechSupported] = useState(false);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      inputRef.current?.focus();
    }
  }, [messages, isOpen]);

  // Initialize Web Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-IN"; // English (India) default

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((res) => res[0].transcript)
          .join("");
        setInputMessage(transcript);
      };

      recognition.onerror = (event) => {
        console.warn("[Voice Recognition Error]", event.error);
        setIsListening(false);
        if (event.error === "not-allowed") {
          toast.error("Microphone access denied. Please allow microphone permission in your browser.");
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } else {
      setSpeechSupported(false);
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Text-To-Speech Playback
  const speakText = (text) => {
    if (!voiceEnabled || !window.speechSynthesis) return;

    // Stop previous utterance
    window.speechSynthesis.cancel();

    // Clean markdown before speaking
    const cleanText = text
      .replace(/[*_~`#]+/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.lang = "en-IN";

    // Attempt to pick a natural voice
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find((v) => v.lang.includes("en-IN") || v.lang.includes("en-US"));
    if (naturalVoice) utterance.voice = naturalVoice;

    window.speechSynthesis.speak(utterance);
  };

  // Toggle Voice Recording
  const handleVoiceToggle = () => {
    if (!speechSupported) {
      toast.info("Voice recognition is not supported in this browser. Try Chrome or Edge!");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      // If we have text, auto-send it
      if (inputMessage.trim()) {
        sendMessage(inputMessage.trim());
      }
    } else {
      // Stop any speech playback
      window.speechSynthesis?.cancel();
      try {
        recognitionRef.current?.start();
      } catch (err) {
        console.error("Failed to start voice recognition:", err);
      }
    }
  };

  // Send Message Handler
  const sendMessage = async (textToSend) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || loading) return;

    // Cancel listening if active
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    const userMessage = {
      id: Date.now().toString(),
      role: "user",
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setLoading(true);

    try {
      // Build conversation history format
      const history = messages
        .filter((m) => m.id !== "welcome")
        .slice(-4)
        .map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.text,
        }));

      const res = await fetch(`${BASE_URL}/api/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text, history }),
      });

      const data = await res.json();

      if (data.success) {
        const aiMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          text: data.reply,
          products: data.recommendedProducts || [],
          followUps: data.suggestedFollowUps || [],
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        setMessages((prev) => [...prev, aiMessage]);

        // Speak aloud if voice enabled
        speakText(data.reply);
      } else {
        const errorMsg = data.message || "Failed to get AI response.";
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            text: `⚠️ ${errorMsg}`,
            products: [],
            followUps: ["Try again", "What products do you have?"],
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          text: "⚠️ Network error connecting to AI assistant. Please check your connection and try again.",
          products: [],
          followUps: [],
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Add Product to Cart from Chat
  const handleAddToCart = (product) => {
    const defaultSize = product.sizes && product.sizes.length > 0 ? product.sizes[0] : "";
    dispatch(
      addToCart({
        product: {
          ...product,
          id: product._id,
          selectedSize: defaultSize,
        },
        num: 1,
      })
    );
    toast.success(`🛍️ Added ${product.productName} to your cart!`);
  };

  // Reset Chat Conversation
  const resetChat = () => {
    window.speechSynthesis?.cancel();
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: "👋 Chat reset! How can I help you find what you love today?",
        products: [],
        followUps: DEFAULT_SUGGESTIONS,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  return (
    <div className="ai-chatbot-wrapper">
      {/* ── Floating Launcher Button ── */}
      {!isOpen && (
        <button
          className="ai-chat-launcher"
          onClick={() => setIsOpen(true)}
          title="Open Nilex AI Voice Shopping Assistant"
          aria-label="Open AI Shopping Assistant"
        >
          <div className="ai-launcher-icon-wrap">
            <span className="ai-launcher-sparkle">✨</span>
            <span className="ai-launcher-avatar">🤖</span>
          </div>
          <div className="ai-launcher-text">
            <span className="ai-launcher-title">Nilex AI</span>
            <span className="ai-launcher-subtitle">🎙️ Voice & Stylist</span>
          </div>
          <span className="ai-launcher-pulse" />
        </button>
      )}

      {/* ── Chat Modal Window ── */}
      {isOpen && (
        <div className="ai-chat-window">
          {/* Header */}
          <div className="ai-chat-header">
            <div className="ai-chat-header-info">
              <div className="ai-chat-avatar-status">
                <span className="ai-chat-header-icon">✨</span>
                <span className="ai-online-dot" />
              </div>
              <div>
                <h6 className="ai-chat-title">Nilex AI Shopping Stylist</h6>
                <p className="ai-chat-status-text">
                  {isListening ? "🎙️ Listening to you..." : "⚡ Live AI • Voice Enabled"}
                </p>
              </div>
            </div>

            <div className="ai-chat-header-actions">
              {/* Audio Playback Toggle */}
              <button
                className={`ai-header-btn ${voiceEnabled ? "active" : ""}`}
                onClick={() => {
                  if (voiceEnabled) window.speechSynthesis?.cancel();
                  setVoiceEnabled(!voiceEnabled);
                }}
                title={voiceEnabled ? "Mute Voice Reading" : "Enable Voice Reading"}
              >
                {voiceEnabled ? "🔊" : "🔇"}
              </button>

              {/* Reset Chat */}
              <button
                className="ai-header-btn"
                onClick={resetChat}
                title="Restart conversation"
              >
                🔄
              </button>

              {/* Close Window */}
              <button
                className="ai-header-btn ai-close-btn"
                onClick={() => {
                  window.speechSynthesis?.cancel();
                  if (isListening) recognitionRef.current?.stop();
                  setIsOpen(false);
                }}
                title="Close chat"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Messages Body */}
          <div className="ai-chat-body">
            {messages.map((msg) => (
              <div key={msg.id} className={`ai-msg-row ${msg.role === "user" ? "user-row" : "ai-row"}`}>
                {msg.role === "assistant" && (
                  <div className="ai-msg-avatar">
                    <span>✨</span>
                  </div>
                )}

                <div className="ai-msg-content-wrap">
                  <div className={`ai-msg-bubble ${msg.role === "user" ? "user-bubble" : "ai-bubble"}`}>
                    <p className="ai-msg-text">{msg.text}</p>
                    <span className="ai-msg-time">{msg.timestamp}</span>
                  </div>

                  {/* Embedded Recommended Product Cards */}
                  {msg.products && msg.products.length > 0 && (
                    <div className="ai-products-grid">
                      {msg.products.map((prod) => (
                        <div key={prod._id} className="ai-product-card">
                          <div
                            className="ai-prod-img-wrap"
                            onClick={() => {
                              setIsOpen(false);
                              navigate(`/shop/${prod._id}`);
                            }}
                          >
                            {prod.imgUrl ? (
                              <img src={prod.imgUrl} alt={prod.productName} className="ai-prod-img" />
                            ) : (
                              <div className="ai-prod-img-fallback">🛍️</div>
                            )}
                            {prod.discount > 0 && (
                              <span className="ai-prod-discount">{prod.discount}% OFF</span>
                            )}
                          </div>

                          <div className="ai-prod-info">
                            <h6
                              className="ai-prod-name"
                              onClick={() => {
                                setIsOpen(false);
                                navigate(`/shop/${prod._id}`);
                              }}
                            >
                              {prod.productName}
                            </h6>
                            <span className="ai-prod-cat">{prod.category}</span>
                            <div className="ai-prod-price-row">
                              <span className="ai-prod-price">₹{prod.price}</span>
                              <button
                                className="ai-add-cart-btn"
                                onClick={() => handleAddToCart(prod)}
                                title="Add to Cart"
                              >
                                🛒 Add
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Follow-up Suggestion Chips */}
                  {msg.followUps && msg.followUps.length > 0 && (
                    <div className="ai-followups-row">
                      {msg.followUps.map((chip, idx) => (
                        <button
                          key={idx}
                          className="ai-followup-chip"
                          onClick={() => sendMessage(chip)}
                          disabled={loading}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Loading Typing Indicator */}
            {loading && (
              <div className="ai-msg-row ai-row">
                <div className="ai-msg-avatar">
                  <span>✨</span>
                </div>
                <div className="ai-typing-indicator">
                  <span className="ai-typing-dot" />
                  <span className="ai-typing-dot" />
                  <span className="ai-typing-dot" />
                  <span className="ai-typing-text">Thinking…</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Voice Wave Visualizer when Listening */}
          {isListening && (
            <div className="ai-voice-recording-banner">
              <div className="ai-sound-waves">
                <span className="sound-wave wave-1" />
                <span className="sound-wave wave-2" />
                <span className="sound-wave wave-3" />
                <span className="sound-wave wave-4" />
                <span className="sound-wave wave-5" />
              </div>
              <span className="ai-recording-label">Listening... Speak your command</span>
              <button className="ai-stop-rec-btn" onClick={handleVoiceToggle}>
                Done
              </button>
            </div>
          )}

          {/* Input Footer */}
          <form
            className="ai-chat-footer"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
          >
            {/* 🎙️ Voice Microphone Button */}
            <button
              type="button"
              className={`ai-mic-btn ${isListening ? "listening" : ""}`}
              onClick={handleVoiceToggle}
              title={isListening ? "Stop listening" : "Speak with Voice Command"}
            >
              {isListening ? "🛑" : "🎙️"}
            </button>

            <input
              ref={inputRef}
              type="text"
              className="ai-chat-input"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder={isListening ? "Listening to your voice…" : "Ask anything or tap mic to speak…"}
              disabled={loading}
            />

            <button
              type="submit"
              className="ai-send-btn"
              disabled={!inputMessage.trim() || loading}
              title="Send message"
            >
              🚀
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default AIChatbot;
