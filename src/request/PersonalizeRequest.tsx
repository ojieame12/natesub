import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Mic, Square, Play, Pause, Trash2, Sparkles } from 'lucide-react'
import { useRequestStore, getDefaultMessage } from './store'
import { useCurrentUser, uploadBlob } from '../api/hooks'
import { getCurrencySymbol, formatCompactNumber } from '../utils/currency'
import { Pressable } from '../components'
import './request.css'

export default function PersonalizeRequest() {
    const navigate = useNavigate()
    const { data: userData } = useCurrentUser()
    const isService = userData?.profile?.purpose === 'service'
    const currencySymbol = getCurrencySymbol(userData?.profile?.currency || 'USD')
    const {
        recipient,
        relationship,
        amount,
        isRecurring,
        message,
        voiceNoteUrl,
        voiceNoteDuration,
        setMessage,
        setVoiceNote,
    } = useRequestStore()

    const [isRecording, setIsRecording] = useState(false)
    const [isUploading, setIsUploading] = useState(false)
    const [recordingTime, setRecordingTime] = useState(0)
    const [isPlaying, setIsPlaying] = useState(false)
    const [playbackTime, setPlaybackTime] = useState(0)
    const [micError, setMicError] = useState<string | null>(null)

    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const timerRef = useRef<number | null>(null)

    // Initialize message with smart default
    useEffect(() => {
        if (!message && recipient) {
            const defaultMsg = getDefaultMessage(recipient.name, relationship, Number(amount) || 0, isRecurring, currencySymbol)
            setMessage(defaultMsg)
        }
    }, [recipient, relationship, amount, isRecurring, message, setMessage, currencySymbol])

    if (!recipient) {
        navigate('/request/new')
        return null
    }

    const firstName = recipient.name.split(' ')[0]

    const startRecording = async () => {
        setMicError(null)

        // Check if mediaDevices is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setMicError('Voice recording is not supported on this device')
            return
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

            // Detect best supported MIME type (like VoiceRecorder does)
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

            const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined
            mediaRecorderRef.current = new MediaRecorder(stream, options)
            audioChunksRef.current = []

            // Store the actual MIME type being used
            const actualMimeType = mediaRecorderRef.current.mimeType || 'audio/webm'

            mediaRecorderRef.current.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data)
            }

            mediaRecorderRef.current.onstop = async () => {
                // Use detected MIME type, not hardcoded
                const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType })

                // 1. Optimistic local preview
                const localUrl = URL.createObjectURL(audioBlob)
                setVoiceNote(localUrl, recordingTime)

                // 2. Upload to S3 - let uploadBlob use blob.type
                setIsUploading(true)
                try {
                    const s3Url = await uploadBlob(audioBlob, 'voice')
                    // Update store with the REAL public URL
                    // Note: We keep the duration from the recording session
                    setVoiceNote(s3Url, recordingTime)
                } catch (e) {
                    console.error('Failed to upload voice note:', e)
                    setMicError('Failed to upload voice note. Please try again.')
                    // Revert local state if upload fails
                    setVoiceNote(null, 0)
                } finally {
                    setIsUploading(false)
                }

                stream.getTracks().forEach(track => track.stop())
            }

            mediaRecorderRef.current.start()
            setIsRecording(true)
            setRecordingTime(0)

            timerRef.current = window.setInterval(() => {
                setRecordingTime(prev => {
                    if (prev >= 60) {
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

    const deleteRecording = () => {
        if (voiceNoteUrl) {
            URL.revokeObjectURL(voiceNoteUrl)
        }
        setVoiceNote(null, 0)
        setPlaybackTime(0)
        setIsPlaying(false)
    }

    // Handles play() Promise properly to avoid UI desync
    const togglePlayback = async () => {
        if (!voiceNoteUrl) return

        if (!audioRef.current) {
            audioRef.current = new Audio(voiceNoteUrl)
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

    const handleContinue = () => {
        navigate('/request/preview')
    }

    const regenerateMessage = () => {
        const newMsg = getDefaultMessage(recipient.name, relationship, Number(amount) || 0, isRecurring, currencySymbol)
        setMessage(newMsg)
    }

    return (
        <div className="request-page">
            {/* Header */}
            <header className="request-header">
                <Pressable className="request-back-btn" onClick={() => navigate(-1)}>
                    <ChevronLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <div className="request-header-spacer" />
            </header>

            <div className="request-content">
                {/* Recipient Badge */}
                <div className="request-recipient-badge">
                    <div className="request-recipient-avatar-small">
                        {recipient.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="request-recipient-badge-name">{firstName}</span>
                    <span className="request-amount-badge">{currencySymbol}{formatCompactNumber(Number(amount) || 0)}{isRecurring ? '/mo' : ''}</span>
                </div>

                {/* Message Section */}
                <div className="request-message-section">
                    <div className="request-label-row">
                        <label className="request-label">{isService ? 'Invoice note' : 'Your message'}</label>
                        <Pressable className="request-regenerate-btn" onClick={regenerateMessage}>
                            <Sparkles size={14} />
                            <span>Regenerate</span>
                        </Pressable>
                    </div>
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={isService ? "Add details about this invoice..." : "Write a personal message..."}
                        className="request-message-textarea"
                        rows={4}
                    />
                    <span className="request-char-count">{message.length}/500</span>
                </div>

                {/* Voice Note Section */}
                <div className="request-voice-section">
                    <label className="request-label">Add a voice note (optional)</label>
                    <p className="request-voice-hint">A personal voice message makes your request more meaningful</p>

                    {voiceNoteUrl ? (
                        /* Playback UI */
                        <div className="request-voice-playback">
                            <Pressable className="request-voice-play-btn" onClick={togglePlayback}>
                                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                            </Pressable>
                            <div className="request-voice-progress">
                                <div className="request-voice-waveform">
                                    {Array.from({ length: 30 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className={`request-waveform-bar ${i < (playbackTime / voiceNoteDuration) * 30 ? 'played' : ''}`}
                                            style={{ height: `${Math.random() * 60 + 20}%` }}
                                        />
                                    ))}
                                </div>
                                <span className="request-voice-time">
                                    {formatTime(playbackTime)} / {formatTime(voiceNoteDuration)}
                                </span>
                            </div>
                            <Pressable className="request-voice-delete-btn" onClick={deleteRecording}>
                                <Trash2 size={18} />
                            </Pressable>
                        </div>
                    ) : isRecording ? (
                        /* Recording UI */
                        <div className="request-voice-recording">
                            <div className="request-recording-indicator">
                                <span className="request-recording-dot" />
                                <span className="request-recording-time">{formatTime(recordingTime)}</span>
                            </div>
                            <Pressable className="request-voice-stop-btn" onClick={stopRecording}>
                                <Square size={20} />
                                <span>Stop</span>
                            </Pressable>
                        </div>
                    ) : (
                        /* Start Recording Button */
                        <>
                            <Pressable className="request-voice-record-btn" onClick={startRecording}>
                                <Mic size={20} />
                                <span>Record Voice Note</span>
                            </Pressable>
                            {micError && (
                                <p className="request-mic-error">{micError}</p>
                            )}
                        </>
                    )}
                    {isUploading && (
                        <div className="request-voice-uploading">
                            <span className="request-voice-uploading-spinner" />
                            <span>Uploading voice note...</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Continue Button */}
            <div className="request-footer">
                <Pressable
                    className={`request-continue-btn ${isUploading ? 'disabled' : ''}`}
                    onClick={handleContinue}
                    disabled={isUploading}
                >
                    {isService ? 'Preview Invoice' : 'Preview Request'}
                </Pressable>
            </div>
        </div>
    )
}
