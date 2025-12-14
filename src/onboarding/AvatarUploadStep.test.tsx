import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/testUtils'
import { useOnboardingStore } from './store'
import AvatarUploadStep from './AvatarUploadStep'

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
}))

vi.mock('../api/hooks', () => {
  return {
    uploadFile: mocks.uploadFile,
  }
})

describe('onboarding/AvatarUploadStep', () => {
  beforeEach(() => {
    mocks.uploadFile.mockReset()
  })

  it('blocks files over 10MB before attempting upload', () => {
    useOnboardingStore.getState().reset()

    const { container } = renderWithProviders(<AvatarUploadStep />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!input) throw new Error('Missing file input')

    const bigFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [bigFile] } })

    expect(screen.getByText('Image must be under 10MB')).toBeInTheDocument()
    expect(mocks.uploadFile).not.toHaveBeenCalled()
  })

  it('uploads a valid image file and stores the resulting public URL', async () => {
    useOnboardingStore.getState().reset()
    mocks.uploadFile.mockResolvedValueOnce('https://cdn.example.com/avatar.jpg')

    const { container } = renderWithProviders(<AvatarUploadStep />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!input) throw new Error('Missing file input')

    const file = new File([new Uint8Array([1, 2, 3])], 'ok.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(mocks.uploadFile).toHaveBeenCalledWith(file, 'avatar')
      expect(useOnboardingStore.getState().avatarUrl).toBe('https://cdn.example.com/avatar.jpg')
    })

    expect(screen.getByAltText('Avatar')).toBeInTheDocument()
  })
})
