/*
 * Entry gate: Portfolio Demonstration Disclaimer.
 *
 * Shown on entry (homepage and app pages share this script). The visitor reads
 * the disclaimer and chooses "Accept and enter" (no password).
 * Escape, the backdrop and closing by any other means do not dismiss it;
 * "Leave site" goes away from the page. Acceptance is remembered per browser
 * (localStorage) and asked again when VERSION (the wording) changes.
 *
 * It uses the design system's modal, field and button styles (.ds-modal*,
 * .ds-field__hint, .ds-button*) and the native <dialog> element: the page behind
 * is inert and focus is trapped. The homepage footer repeats the disclaimer text
 * (index.static.txt).
 */
(() => {
  const KEY = 'karl.disclaimer'
  const VERSION = '2' // bumped: every visitor sees the disclaimer again (once)

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

  // Accepted this VERSION — also by the earlier password gate, which stored
  // "<version>:<hash>", so those visitors are not asked again.
  function accepted() {
    try {
      const stored = window.localStorage.getItem(KEY)
      return stored === VERSION || Boolean(stored?.startsWith(`${VERSION}:`))
    } catch {
      return false
    }
  }

  function remember() {
    try {
      window.localStorage.setItem(KEY, VERSION)
    } catch {
      // Storage blocked: the gate is shown again on the next visit.
    }
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

    // Confirmation + actions.
    const form = element('form', 'km-gate-form')
    form.noValidate = true
    const confirm = element('p', 'ds-field__hint', 'By entering, you confirm you have read and accept the disclaimer above.')
    confirm.id = 'km-gate-confirm'

    const footer = element('div', 'ds-modal__footer')
    const leave = element('button', 'ds-button ds-button--secondary', 'Leave site')
    leave.type = 'button'
    const accept = element('button', 'ds-button', 'Accept and enter')
    accept.type = 'submit'
    accept.setAttribute('aria-describedby', 'km-gate-confirm')
    footer.append(leave, accept)
    form.append(confirm, footer)

    inner.append(header, body, form)
    dialog.append(inner)
    return { dialog, title, form, leave }
  }

  function show() {
    if (accepted()) return

    const { dialog, title, form, leave } = build()
    document.body.append(dialog)
    let done = false

    // Escape (first press) is cancelled; browsers that close the dialog anyway
    // (a repeated Escape) get it reopened.
    dialog.addEventListener('cancel', (event) => event.preventDefault())
    dialog.addEventListener('close', () => {
      if (!done) dialog.showModal()
    })

    form.addEventListener('submit', (event) => {
      event.preventDefault()
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
