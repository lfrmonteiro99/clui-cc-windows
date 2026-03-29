export interface TerminalColorScheme {
  name: string
  colors: {
    black: string; red: string; green: string; yellow: string
    blue: string; magenta: string; cyan: string; white: string
    brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string
    brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string
    foreground: string; background: string; cursor: string; selectionBackground: string
  }
}

export const TERMINAL_SCHEMES: TerminalColorScheme[] = [
  {
    name: 'Default',
    colors: {
      background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d97757', selectionBackground: 'rgba(217,119,87,0.3)',
      black: '#6b7280', red: '#ef4444', green: '#22c55e', yellow: '#eab308',
      blue: '#3b82f6', magenta: '#a855f7', cyan: '#06b6d4', white: '#d4d4d4',
      brightBlack: '#9ca3af', brightRed: '#f87171', brightGreen: '#4ade80', brightYellow: '#facc15',
      brightBlue: '#60a5fa', brightMagenta: '#c084fc', brightCyan: '#22d3ee', brightWhite: '#ffffff',
    }
  },
  {
    name: 'Dracula',
    colors: {
      background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
      brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
    }
  },
  {
    name: 'Nord',
    colors: {
      background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
    }
  },
  {
    name: 'Solarized Dark',
    colors: {
      background: '#002b36', foreground: '#839496', cursor: '#839496', selectionBackground: '#073642',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
      brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    }
  },
  {
    name: 'Solarized Light',
    colors: {
      background: '#fdf6e3', foreground: '#657b83', cursor: '#657b83', selectionBackground: '#eee8d5',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
      brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    }
  },
  {
    name: 'Monokai',
    colors: {
      background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', selectionBackground: '#49483e',
      black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
      blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
      brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75',
      brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
    }
  },
  {
    name: 'One Dark',
    colors: {
      background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selectionBackground: '#3e4451',
      black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
      blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
      brightBlack: '#545862', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
      brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#c8ccd4',
    }
  },
  {
    name: 'Gruvbox',
    colors: {
      background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: '#3c3836',
      black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
      blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
      brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f',
      brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
    }
  },
]
