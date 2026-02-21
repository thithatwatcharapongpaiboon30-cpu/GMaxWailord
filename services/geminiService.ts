import { GoogleGenAI, Modality } from "@google/genai";
import { Subject } from "../types";
import { SYSTEM_PROMPTS } from "../constants";

export const getTutorResponse = async (subject: Subject, message: string, history: { role: 'user' | 'model', content: string }[] = []) => {
  try {
    // Standard initialization per instructions
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Choose model based on complexity (STEM subjects use Pro)
    const modelName = ['Math', 'Physics', 'Chemistry', 'TPAT1'].includes(subject) 
      ? 'gemini-3-pro-preview' 
      : 'gemini-3-flash-preview';

    // Limit history length to prevent context window issues
    const conversationHistory = [
      ...history.slice(-6).map(h => ({
        role: h.role,
        parts: [{ text: h.content }]
      })),
      { role: 'user', parts: [{ text: message }] }
    ];

    const response = await ai.models.generateContent({
      model: modelName,
      contents: conversationHistory,
      config: {
        systemInstruction: SYSTEM_PROMPTS[subject],
        temperature: 0.7,
        topP: 0.9,
      }
    });

    if (!response || !response.text) {
      throw new Error("No text returned from node");
    }

    return response.text;
  } catch (error: any) {
    console.error("Gemini AI Session Error:", error);
    // If you see this on Vercel, ensure the API_KEY env var is set in the dashboard.
    return "The specialist node is temporarily unavailable. Check your connection or API configuration and try again.";
  }
};

let audioContext: AudioContext | null = null;

const getAudioContext = () => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
};

export const resumeAudio = () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  } catch (e) {}
};

export const playNotificationSound = (type: 'default' | 'alarm' = 'default') => {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    if (type === 'alarm') {
      // More urgent sound for session end
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.5);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 1.0);
      
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.1);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.9);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1.2);
    } else {
      // Standard notification beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
      
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch (e) {
    console.error("Audio play error:", e);
  }
};

export const speakText = async (text: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text.slice(0, 250) }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      const audioData = atob(base64Audio);
      const arrayBuffer = new ArrayBuffer(audioData.length);
      const view = new Uint8Array(arrayBuffer);
      for (let i = 0; i < audioData.length; i++) {
        view[i] = audioData.charCodeAt(i);
      }
      const ctx = getAudioContext();
      const dataInt16 = new Int16Array(arrayBuffer);
      const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
      const channelData = buffer.getChannelData(0);
      for (let i = 0; i < dataInt16.length; i++) {
        channelData[i] = dataInt16[i] / 32768.0;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
    }
  } catch (error) {}
  return false;
};