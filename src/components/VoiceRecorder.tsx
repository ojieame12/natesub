import { useState, useRef, useEffect, useMemo } from 'react'
import { Mic, Square, Play, Pause, X, RefreshCw, Loader2 } from 'lucide-react'
import Pressable from './Pressable'
import './VoiceRecorder.css'

interface VoiceRecorderProps {
    onRecorded: (blob: Blob, duration: number) => void
    onRemove: () => void
    audioBlob?: Blob | null
    /** URL to existing audio (for persisted recordings) */
    existingAudioUrl?: string | null
    maxDuration?: number // seconds, default 60
    label?: string
    hint?: string
    /** Show uploading state */
    isUploading?: boolean
}

export function VoiceRecorder({
    onRecorded,
    onRemove,
    audioBlob,
    existingAudioUrl,
    maxDuration = 60,
    label = 'Record a voice message',
    hint,
    isUploading = false,
}: VoiceRecorderProps) {
    const [isRecording, setIsRecording] = useState(false)
    const [recordingTime, setRecordingTime] = useState(0)
    const [isPlaying, setIsPlaying] = useState(false)
    const [playbackTime, setPlaybackTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [micError, setMicError] = useState<string | null>(null)
    const audioUrl = useMemo(() => {
        if (audioBlob) return URL.createObjectURL(audioBlob)
        if (existingAudioUrl) return existingAudioUrl
        return null
    }, [audioBlob, existingAudioUrl])

    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const timerRef = useRef<number | null>(null)

    // Create audio URL from blob or use existing URL
    useEffect(() => {
        if (!audioUrl) {
            setDuration(0)
            return
        }

        // Get duration from current URL
        const audio = new Audio(audioUrl)
        audio.onloadedmetadata = () => {
            setDuration(Math.ceil(audio.duration))
        }

        return () => {
            if (audioBlob) {
                URL.revokeObjectURL(audioUrl)
            }
        }
    }, [audioUrl, audioBlob])

    const startRecording = async () => {
        setMicError(null)

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setMicError('Voice recording is not supported on this device')
            return
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

            // Determine the best supported MIME type for this browser
            // iOS Safari: audio/mp4, audio/aac
            // Chrome/Firefox: audio/webm, audio/ogg
            const mimeTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4',
                'audio/ogg;codecs=opus',
                'audio/ogg',
            ]

            let selectedMimeType = ''
            for (const mimeType of mimeTypes) {
                if (MediaRecorder.isTypeSupported(mimeType)) {
                    selectedMimeType = mimeType
                    break
                }
            }

            // Create MediaRecorder with detected MIME type (or let browser choose default)
            const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined
            mediaRecorderRef.current = new MediaRecorder(stream, options)
            audioChunksRef.current = []

            // Store the actual MIME type being used
            const actualMimeType = mediaRecorderRef.current.mimeType || 'audio/webm'

            mediaRecorderRef.current.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data)
            }

            mediaRecorderRef.current.onstop = () => {
                // Use the actual MIME type from MediaRecorder, not hardcoded
                const blob = new Blob(audioChunksRef.current, { type: actualMimeType })
                onRecorded(blob, recordingTime)
                stream.getTracks().forEach(track => track.stop())
            }

            mediaRecorderRef.current.start()
            setIsRecording(true)
            setRecordingTime(0)

            timerRef.current = window.setInterval(() => {
                setRecordingTime(prev => {
                    if (prev >= maxDuration) {
                        stopRecording()
                        return prev
                    }
                    return prev + 1
                })
            }, 1000)
        } catch (err: unknown) {
            console.error('Failed to start recording:', err)
            const error = err as { name?: string }
            if (error.name === 'NotAllowedError') {
                setMicError('Microphone access denied. Check your settings.')
            } else if (error.name === 'NotFoundError') {
                setMicError('No microphone found on this device')
            } else {
                setMicError('Could not access microphone')
            }
        }
    }

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop()
            setIsRecording(false)
            if (timerRef.current) {
                clearInterval(timerRef.current)
            }
        }
    }

    const handleRemove = () => {
        if (audioBlob && audioUrl) {
            URL.revokeObjectURL(audioUrl)
        }
        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current = null
        }
        setPlaybackTime(0)
        setIsPlaying(false)
        setDuration(0)
        onRemove()
    }

    // Handles play() Promise properly to avoid UI desync
    const togglePlayback = async () => {
        if (!audioUrl) return

        if (!audioRef.current) {
            audioRef.current = new Audio(audioUrl)
            audioRef.current.onended = () => {
                setIsPlaying(false)
                setPlaybackTime(0)
            }
            audioRef.current.ontimeupdate = () => {
                setPlaybackTime(Math.floor(audioRef.current?.currentTime || 0))
            }
        }

        if (isPlaying) {
            audioRef.current.pause()
            setIsPlaying(false)
        } else {
            try {
                await audioRef.current.play()
                setIsPlaying(true)
            } catch (err) {
                console.error('Audio playback failed:', err)
                setIsPlaying(false)
            }
        }
    }

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current)
            }
            if (audioRef.current) {
                audioRef.current.pause()
            }
        }
    }, [])

    // Has recording (or is uploading)
    if ((audioUrl || isUploading) && !isRecording) {
        return (
            <div className="voice-recorder">
                {label && <label className="voice-recorder-label">{label}</label>}
                <div className={`voice-recorder-playback ${isUploading ? 'uploading' : ''}`}>
                    <Pressable className="voice-play-btn" onClick={togglePlayback} disabled={isUploading}>
                        {isUploading ? (
                            <Loader2 size={20} className="spinning" />
                        ) : isPlaying ? (
                            <Pause size={20} />
                        ) : (
                            <Play size={20} />
                        )}
                    </Pressable>
                    <div className="voice-progress">
                        <div className="voice-progress-bar">
                            <div
                                className="voice-progress-fill"
                                style={{ width: `${duration > 0 ? (playbackTime / duration) * 100 : 0}%` }}
                            />
                        </div>
                        <span className="voice-time">
                            {isUploading ? 'Uploading...' : `${formatTime(playbackTime)} / ${formatTime(duration)}`}
                        </span>
                    </div>
                    <div className="voice-actions">
                        <Pressable className="voice-action-btn" onClick={handleRemove} disabled={isUploading}>
                            <X size={18} />
                        </Pressable>
                        <Pressable className="voice-action-btn" onClick={() => { handleRemove(); startRecording(); }} disabled={isUploading}>
                            <RefreshCw size={18} />
                        </Pressable>
                    </div>
                </div>
            </div>
        )
    }

    // Recording state
    if (isRecording) {
        return (
            <div className="voice-recorder">
                {label && <label className="voice-recorder-label">{label}</label>}
                <div className="voice-recorder-recording">
                    <div className="voice-recording-indicator">
                        <span className="voice-recording-dot" />
                        <span className="voice-recording-time">
                            {formatTime(recordingTime)} / {formatTime(maxDuration)}
                        </span>
                    </div>
                    <div className="voice-waveform">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div key={i} className="voice-waveform-bar" />
                        ))}
                    </div>
                    <Pressable className="voice-stop-btn" onClick={stopRecording}>
                        <Square size={16} />
                        <span>Tap to stop</span>
                    </Pressable>
                </div>
            </div>
        )
    }

    // Idle state
    return (
        <div className="voice-recorder">
            {label && <label className="voice-recorder-label">{label}</label>}
            {hint && <p className="voice-recorder-hint">{hint}</p>}
            <Pressable className="voice-record-btn" onClick={startRecording}>
                <Mic size={20} />
                <span>Record voice message</span>
            </Pressable>
            {micError && (
                <p className="voice-recorder-error">{micError}</p>
            )}
        </div>
    )
}
