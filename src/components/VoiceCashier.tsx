import React, { useState, useRef } from 'react';
import { Mic, Square, Loader2, Volume2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface VoiceCashierProps {
  onTranscriptSuccess?: (transcript: string) => void;
}

export const VoiceCashier: React.FC<VoiceCashierProps> = ({ onTranscriptSuccess }) => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  /**
   * Dynamically extracts the Groq API key from local storage at runtime.
   * Completely bypasses hardcoded code configuration pipelines.
   */
  const resolveGroqApiKey = (): string | null => {
    try {
      // 1. Primary Look-up: Secure dynamic tenant gateway configurations
      const gatewayConfigRaw = localStorage.getItem('pos_gateway_config');
      if (gatewayConfigRaw) {
        const config = JSON.parse(gatewayConfigRaw);
        if (config.groqApiKey) return config.groqApiKey;
      }

      // 2. Secondary Look-up: Legacy settings container fallback
      const legacySettingsRaw = localStorage.getItem('pos_legacy_settings');
      if (legacySettingsRaw) {
        const settings = JSON.parse(legacySettingsRaw);
        if (settings.groqApiKey) return settings.groqApiKey;
      }
    } catch (error) {
      console.error('Failed to parse storage gateway authentication profiles:', error);
    }
    return null;
  };

  const startRecording = async () => {
    setErrorMessage(null);
    audioChunksRef.current = [];
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudioWithGroq(audioBlob);
        
        // Explicitly tear down audio channels to release device hardware hooks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to capture audio driver permissions:', err);
      setErrorMessage('Microphone hardware access denied or unavailable.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudioWithGroq = async (audioBlob: Blob) => {
    const apiKey = resolveGroqApiKey();

    if (!apiKey) {
      setErrorMessage('Groq API Key missing. Please configure it in System Gateway Settings.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'voice_command.webm');
      formData.append('model', 'whisper-large-v3');
      formData.append('response_format', 'json');
      
      // REFINED FIELD CONTEXT: Instructs Whisper to only score item lists and numeric count definitions
      formData.append('prompt', 'quantity, items, item description, count, product name, piece, pack, numbers'); 

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `HTTP error! Status code: ${response.status}`);
      }

      const data = await response.json();
      const detectedText = data.text || '';
      
      setTranscript(detectedText);
      
      if (onTranscriptSuccess && detectedText.trim().length > 0) {
        onTranscriptSuccess(detectedText);
      }
    } catch (err: any) {
      console.error('Groq Speech Engine Transcribe Failure:', err);
      setErrorMessage(err.message || 'Failed to transcribe captured hardware audio stream.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto shadow-md border border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Volume2 className="h-5 w-5 text-primary" />
          Voice Cashier Mode
        </CardTitle>
        <CardDescription>
          Stream real-time voice commands directly into the transactional runtime.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        
        {/* Guard and Warning Alert Pipeline */}
        {errorMessage && (
          <Alert variant="destructive" className="animate-in fade-in-50 duration-200">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>System Gateway Error</AlertTitle>
            <AlertDescription className="text-xs font-mono mt-1">
              {errorMessage}
            </AlertDescription>
          </Alert>
        )}

        {/* Recording States & Transcribed Visual Matrix */}
        <div className="flex flex-col items-center justify-center p-6 border border-dashed rounded-xl bg-muted/40 min-h-[160px] relative transition-all">
          {isProcessing ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm font-medium">Whisper parsing stream runtime...</span>
            </div>
          ) : isRecording ? (
            <div className="flex flex-col items-center gap-3">
              <div className="absolute inset-0 bg-destructive/5 rounded-xl animate-pulse pointer-events-none" />
              <span className="relative flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-destructive"></span>
              </span>
              <span className="text-sm font-semibold text-destructive animate-pulse">Streaming Audio Local-First...</span>
            </div>
          ) : transcript ? (
            <div className="w-full px-2 text-center animate-in fade-in duration-300">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Captured Transcript</span>
              <p className="text-sm font-medium italic text-foreground bg-background p-3 rounded-lg border">
                "{transcript}"
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground font-medium text-center">
              Microphone idle. Ready to parse transactions.
            </p>
          )}
        </div>

        {/* Dynamic Interface Toggles */}
        <div className="flex justify-center pt-2">
          {!isRecording ? (
            <Button 
              size="lg"
              onClick={startRecording}
              disabled={isProcessing}
              className="w-full gap-2 font-semibold shadow transition-all duration-200 hover:scale-[1.01]"
            >
              <Mic className="h-4 w-4" />
              Start Listening
            </Button>
          ) : (
            <Button 
              size="lg"
              variant="destructive"
              onClick={stopRecording}
              className="w-full gap-2 font-semibold animate-pulse"
            >
              <Square className="h-4 w-4 fill-white" />
              Stop & Process
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
