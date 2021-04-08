import { writable } from 'svelte/store'

export const availableStates = {
    stopped: 'stopped', // the focus is not on the editor
    active: 'active', // the user is typing
}

export const fileContent = writable('') // the content of the selected file
export const selectedFile = writable(null) // the selected file\
export const language = writable(null) // the language of the selected file
export const state = writable(availableStates.stopped) // current state
export const sessionStar = writable(null) // the start timestamp of the last session