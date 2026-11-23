/*
 * Entry gate: Portfolio Demonstration Disclaimer + access password.
 *
 * Shown on entry (homepage and app pages share this script). The visitor reads
 * the disclaimer, enters the access password and chooses "Accept and enter".
 * Escape, the backdrop and closing by any other means do not dismiss it;
 * "Leave site" goes away from the page. Acceptance is remembered per browser
 * (localStorage) and asked again when VERSION (the wording) or the password changes.
 *
 * Set the password with:  npm run set-password -- "<new password>"
 * Only its SHA-256 hash is stored here. This is a client-side gate on a static
 * site (the hash is public), not access control: nothing secret depends on it.
 *
 * It uses the design system's modal, field, input and button styles (.ds-modal*,
 * .ds-field*, .ds-input, .ds-button*) and the native <dialog> element: the page behind
 * is inert and focus is trapped. The homepage footer repeats the disclaimer text
 * (index.static.txt).
 */
(() => {
  const KEY = 'karl.disclaimer'
  const VERSION = '3' // bumped: every visitor sees the gate again, now with the password
  const PASSWORD_HASH = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  // Changing the wording (VERSION) or the password asks everyone again.
  const ACCEPTED = `${VERSION}:${PASSWORD_HASH.slice(0, 12)}`

  const TITLE = 'Portfolio Demonstration Disclaimer'
  const PARAGRAPHS = [
    'This website and its associated projects are independently developed for portfolio presentation, educational, research, UI/UX design, software engineering, and technology demonstration purposes.',
    'All aviation scenarios, aircraft callsigns, flight information, traffic simulations, maps, operational data, and interface elements displayed are fictional or synthetically generated. They serve exclusively to showcase design concepts, system architecture, application functionality, and software development capabilities.',
    'This portfolio does not represent an operational Air Traffic Management (ATM) or Air Traffic Control (ATC) system. The applications and demonstrations are not certified, approved, or intended for real-world aviation operations, air navigation, flight planning, or operational decision-making.',
    'No proprietary, confidential, or operationally sensitive information is intentionally disclosed or incorporated. All projects and materials are independently developed and are not affiliated with, sponsored by, endorsed by, or officially associated with any air navigation service provider, airport, airline, aviation authority, or technology vendor.',
  ]
  const NOTICE_LABEL = 'Important Notice:'
  const NOTICE =
    ' All content is provided strictly for demonstration and informational purposes. It must not be used, interpreted, or relied upon for actual aviation operations, air traffic control, navigation, or safety-critical decision-making.'

  function accepted() {
    try {
      return window.localStorage.getItem(KEY) === ACCEPTED
    } catch {
      return false
    }
  }

  function remember() {
    try {
      window.localStorage.setItem(KEY, ACCEPTED)
    } catch {
      // Storage blocked: the gate is shown again on the next visit.
    }
  }

  async function sha256(text) {
    const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
  }

  function element(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text) node.textContent = text
    return node
  }

  function build() {
    const dialog = element('dialog', 'ds-modal ds-modal--lg km-gate')
    dialog.setAttribute('aria-labelledby', 'km-gate-title')

    const inner = element('div', 'ds-modal__inner')

    const header = element('div', 'ds-modal__header')
    const heading = element('div')
    heading.append(element('p', 'km-gate-kicker', 'Before you enter'))
    const title = element('h2', 'ds-modal__title', TITLE)
    title.id = 'km-gate-title'
    title.tabIndex = -1
    heading.append(title)
    header.append(heading)

    const body = element('div', 'ds-modal__body km-gate-body')
    // The text can be longer than the screen: let the keyboard scroll it.
    body.tabIndex = 0
    body.setAttribute('role', 'region')
    body.setAttribute('aria-label', 'Disclaimer text')
    for (const text of PARAGRAPHS) body.append(element('p', null, text))
    const notice = element('p', 'km-gate-notice')
    notice.append(element('strong', null, NOTICE_LABEL), document.createTextNode(NOTICE))
    body.append(notice)

    // Password + actions: a real form, so Enter in the field submits.
    const form = element('form', 'km-gate-form')
    form.noValidate = true
    const field = element('div', 'ds-field')
    const label = element('label', 'ds-field__label', 'Access password')
    label.htmlFor = 'km-gate-password'
    const input = element('input', 'ds-input')
    input.id = 'km-gate-password'
    input.type = 'password'
    input.name = 'password'
    input.autocomplete = 'current-password'
    input.required = true
    input.setAttribute('aria-describedby', 'km-gate-confirm')
    const error = element('p', 'ds-field__error')
    error.id = 'km-gate-error'
    error.setAttribute('role', 'alert')
    error.hidden = true
    const confirm = element('p', 'ds-field__hint', 'By entering, you confirm you have read and accept the disclaimer above.')
    confirm.id = 'km-gate-confirm'
    field.append(label, input, error, confirm)

    const footer = element('div', 'ds-modal__footer')
    const leave = element('button', 'ds-button ds-button--secondary', 'Leave site')
    leave.type = 'button'
    const accept = element('button', 'ds-button', 'Accept and enter')
    accept.type = 'submit'
    footer.append(leave, accept)
    form.append(field, footer)

    inner.append(header, body, form)
    dialog.append(inner)
    return { dialog, title, form, input, error, leave, accept }
  }

  function show() {
    if (accepted()) return

    const { dialog, title, form, input, error, leave, accept } = build()
    document.body.append(dialog)
    let done = false

    // Escape (first press) is cancelled; browsers that close the dialog anyway
    // (a repeated Escape) get it reopened.
    dialog.addEventListener('cancel', (event) => event.preventDefault())
    dialog.addEventListener('close', () => {
      if (!done) dialog.showModal()
    })

    function fail(message) {
      error.textContent = message
      error.hidden = false
      input.setAttribute('aria-invalid', 'true')
      input.setAttribute('aria-describedby', 'km-gate-error km-gate-confirm')
      input.select()
      input.focus()
    }

    input.addEventListener('input', () => {
      if (error.hidden) return
      error.hidden = true
      input.removeAttribute('aria-invalid')
      input.setAttribute('aria-describedby', 'km-gate-confirm')
    })

    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (!input.value) return fail('Enter the access password.')
      if (!window.crypto?.subtle) return fail('This page must be opened over HTTPS to check the password.')
      accept.disabled = true
      const ok = (await sha256(input.value)) === PASSWORD_HASH
      accept.disabled = false
      if (!ok) return fail('Incorrect password. Check it and try again.')
      done = true
      remember()
      dialog.close()
      dialog.remove()
    })

    leave.addEventListener('click', () => {
      window.location.replace('about:blank')
    })

    dialog.showModal()
    // Start at the title so screen readers announce the notice.
    title.focus({ preventScroll: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true })
  else show()
})()
