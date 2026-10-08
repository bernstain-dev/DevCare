import { emitKeypressEvents } from 'node:readline'

export function hiddenPassword(label, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function')
    return Promise.reject(
      new Error(
        'Run this command in your own interactive terminal. Passwords are not accepted through arguments, environment variables or piped input.',
      ),
    )
  return new Promise((resolve, reject) => {
    let value = ''
    const wasRaw = Boolean(input.isRaw)
    const wasReading = input.readableFlowing === true
    function finish(error) {
      input.removeListener('keypress', onKey)
      input.setRawMode(wasRaw)
      if (!wasReading) input.pause()
      output.write('\n')
      if (error) reject(error)
      else resolve(value)
      value = ''
    }
    function onKey(text, key = {}) {
      if ((key.ctrl && key.name === 'c') || (key.ctrl && key.name === 'd'))
        return finish(new Error('Recovery cancelled. No password was submitted.'))
      if (key.name === 'return' || key.name === 'enter') return finish()
      if (key.name === 'backspace') {
        value = [...value].slice(0, -1).join('')
        return
      }
      if (key.ctrl || key.meta || key.name === 'escape' || key.name === 'tab') return
      if (
        text &&
        [...text].every(
          (character) => character.codePointAt(0) >= 32 && character.codePointAt(0) !== 127,
        )
      )
        value += text
    }
    emitKeypressEvents(input)
    input.setRawMode(true)
    input.on('keypress', onKey)
    input.resume()
    output.write(label)
  })
}
