import { create } from 'zustand'

const STORAGE_KEY = 'clui-onboarding-complete'

interface OnboardingState {
  completed: boolean
  setCompleted: () => void
}

function loadCompleted(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  completed: loadCompleted(),
  setCompleted: () => {
    set({ completed: true })
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch (err) {
      console.warn('[onboardingStore] save failed:', err)
    }
  },
}))
