import { useParams, Navigate } from 'react-router-dom'
import { isReservedUsername } from '../utils/constants'
import SubscribeBoundary from './SubscribeBoundary'

// This component handles vanity URLs like nate.to/username
// It checks if the username is valid and renders the subscribe page

export default function UserPage() {
  const { username } = useParams<{ username: string }>()

  // If no username or it's a reserved route, redirect to onboarding
  if (!username || isReservedUsername(username)) {
    return <Navigate to="/onboarding" replace />
  }

  // TODO: In production, this would:
  // 1. Fetch the user profile from API
  // 2. Show loading state
  // 3. Show 404 if user doesn't exist
  // 4. Pass user data to SubscribeBoundary

  // For now, just render the subscribe page with the username
  return <SubscribeBoundary />
}
