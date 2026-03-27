import { describe, it, expect } from 'vitest'
import { isSafeBashCommand } from '../../../src/main/hooks/permission-server'

describe('SEC-001: Remove unsafe commands from SAFE_BASH_COMMANDS', () => {
  it('marks sed as unsafe', () => {
    expect(isSafeBashCommand("sed -i 's/foo/bar/' file")).toBe(false)
  })

  it('marks sed (read-only usage) as unsafe', () => {
    expect(isSafeBashCommand("sed 's/foo/bar/' file")).toBe(false)
  })

  it('marks awk as unsafe', () => {
    expect(isSafeBashCommand("awk '{print $1}' file")).toBe(false)
  })

  it('marks xargs as unsafe', () => {
    expect(isSafeBashCommand('xargs rm')).toBe(false)
  })

  it('marks xargs in a pipeline as unsafe', () => {
    expect(isSafeBashCommand('find . -name "*.tmp" | xargs rm')).toBe(false)
  })

  it('still allows safe commands like cat, ls, grep', () => {
    expect(isSafeBashCommand('cat file.txt')).toBe(true)
    expect(isSafeBashCommand('ls -la')).toBe(true)
    expect(isSafeBashCommand('grep pattern file.txt')).toBe(true)
  })

  it('still allows other Diff/compare commands that remain safe', () => {
    expect(isSafeBashCommand('diff a.txt b.txt')).toBe(true)
    expect(isSafeBashCommand('sort file.txt')).toBe(true)
    expect(isSafeBashCommand('uniq file.txt')).toBe(true)
    expect(isSafeBashCommand('jq .foo file.json')).toBe(true)
    expect(isSafeBashCommand('tr a-z A-Z')).toBe(true)
  })
})

describe('SEC-002: Detect subshell/backtick injection in isSafeBashCommand', () => {
  it('marks $() command substitution as unsafe', () => {
    expect(isSafeBashCommand('echo $(rm -rf /)')).toBe(false)
  })

  it('marks backtick command substitution as unsafe', () => {
    expect(isSafeBashCommand('cat `rm file`')).toBe(false)
  })

  it('marks process substitution <() as unsafe', () => {
    expect(isSafeBashCommand('ls <(echo test)')).toBe(false)
  })

  it('marks nested $() as unsafe', () => {
    expect(isSafeBashCommand('echo $(echo $(whoami))')).toBe(false)
  })

  it('marks $() in piped commands as unsafe', () => {
    expect(isSafeBashCommand('cat file.txt | grep $(cat /etc/passwd)')).toBe(false)
  })

  it('still allows safe commands without injection', () => {
    expect(isSafeBashCommand('cat file.txt')).toBe(true)
    expect(isSafeBashCommand('ls -la /tmp')).toBe(true)
    expect(isSafeBashCommand('grep -r pattern src/')).toBe(true)
    expect(isSafeBashCommand('git log --oneline -10')).toBe(true)
    expect(isSafeBashCommand('echo hello world')).toBe(true)
  })

  it('allows dollar sign in non-substitution contexts', () => {
    // $VAR (variable expansion) is not the same as $() subshell
    expect(isSafeBashCommand('echo $HOME')).toBe(true)
    expect(isSafeBashCommand('echo ${HOME}')).toBe(true)
  })
})
