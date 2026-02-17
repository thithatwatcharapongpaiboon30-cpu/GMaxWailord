import { GoogleGenAI, Modality } from "@google/genai";
import { Subject } from "../types";
import { SYSTEM_PROMPTS } from "../constants";

export const getTutorResponse = async (subject: Subject, message: string, history: { role: 'user' | 'model', content: string }[] = []) => {
  try {
    // The API key must be obtained exclusively from the environment variable process.env.API_KEY.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Advanced reasoning for STEM/Medical subjects
    const modelName = ['Math', 'Physics', 'Chemistry', 'TPAT1'].includes(subject) 
      ? 'gemini-3-pro-preview' 
      : 'gemini-3-flash-preview';

    const conversationHistory = [
      ...history.slice(-8).map(h => ({
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
      }
    });

    if (!response || !response.text) {
      throw new Error("Empty response from AI specialist node");
    }

    return response.text;
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    // On Vercel, if this triggers, check Vercel Dashboard > Project Settings > Environment Variables
    return "Node connection interrupted. Please ensure your API key is configured and try again.";
  }
};

export const playNotificationSound = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
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
  } catch (e) {}
};

export const speakText = async (text: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text.slice(0, 300) }] }],
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
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
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