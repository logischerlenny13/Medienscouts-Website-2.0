import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Lock,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import portalHtmlRaw from './schulportal.html.txt?raw';

type E2eeStep = 'student-create' | 'admin-send' | 'student-decrypt';

const CLEAN_PORTAL_HTML = portalHtmlRaw.replace(
  /<script\b[^>]*src="\/_aistudio-iframe\.js[^"]*"[^>]*><\/script>/gi,
  '',
);

const DEMO_ITEMS = [
  { title: 'IServ Passwort zurücksetzen', category: 'Passwort-Support' },
  { title: 'Moodle Login auf dem Tablet einrichten', category: 'Anleitung' },
  { title: 'WebUntis Stundenplan verbinden', category: 'Video' },
  { title: 'Medienscouts Sprechstunde', category: 'Schwarzes Brett' },
];

const FIXED_BUGS = [
  {
    area: 'Suchleiste exakt nach Vorlage',
    cause: 'Die vorige Capsule war mit 9999px zu stark abgerundet und hatte Abweichungen bei Rahmenbreite und Petrol-Tönen.',
    fix: 'Exakte Proportionen übernommen: Außenrahmen (#245259 → #285759, 1.12rem Radius, 0.45rem Rand), Innenfläche (#193a40 → #1c3d40, 0.74rem Radius) und große weiße Lupe.',
  },
  {
    area: 'Apple Liquid Glass Popups & 4-Schritte-Registrierung',
    cause: 'Login/Registrierung und Popups nutzten schlichte Standard-Karten ohne einheitlichen Liquid-Glass-Look und Portalfarbverlauf.',
    fix: 'Vollbild-Anmeldung mit 4-Schritte-Stepper („Schul-E-Mail“, „Passwort“, „Hinweise“, „Zweite E-Mail“) sowie alle Popups und Toasts im Apple Liquid Glass Design mit euren IC-Icons und Farbverlauf (#05697a → #497538).',
  },
  {
    area: 'Medienscouts-Passwort als Schlüssel',
    cause: 'Die Bezeichnung „Schulportal-Passwort“ wäre mit der App „Schulportal“ verwechselbar und ein Extra-Code wird leicht vergessen.',
    fix: 'Das eigene Medienscouts-Passwort dient direkt als E2EE-Schlüssel – vor Ticket-Erstellung per Firebase Re-Auth gegen Tippfehler geprüft.',
  },
  {
    area: 'Anmeldung 3-fach mit Cookie gesichert',
    cause: 'Beim Neuladen (oder wenn Browser/iPad IndexedDB leert) und bei kurzen Netzwerkwacklern ging der Login-Status verloren.',
    fix: 'Firebase-Auth wird per 1-Jahres-Cookie (ms_fb_auth) + LocalStorage + IndexedDB gesichert und beim Neuladen vor dem Start automatisch wiederhergestellt.',
  },
  {
    area: 'AI-Studio-Skript aus Export entfernt',
    cause: 'Beim Abruf über den Vorschau-Server wurde automatisch <script src="/_aistudio-iframe.js..."> in eure index.html eingefügt.',
    fix: 'Der Export wird jetzt sauber direkt gebündelt, ohne Proxy-Injektion.',
  },
  {
    area: 'Schüler-Chat-Status & Senden',
    cause: 'sendMsg() rief DB.upd() vor dem Leeren des Eingabefelds auf.',
    fix: 'Eingabefeld wird direkt nach DB.addMsg() geleert; Status-Update läuft fehlertolerant.',
  },
  {
    area: 'Firestore-Updates & Klick-Bugs',
    cause: 'Capture-blur, onSnapshot-Rennen während pointerdown/click, focusout-Kollision und Fokusverlust bei #s-q.',
    fix: 'Capture-blur entfernt, pointerActive-Sperre, renderMainOnly() für Suche, chatSessionToken und pointer-events-none ergänzt.',
  },
];

const FIRESTORE_RULES_SNIPPET = `    // In studentMayUpdateOwnTicket() zusätzlich erlauben, damit Schüler beim Senden den Ticket-Status aktualisieren dürfen:
    function studentMayUpdateOwnTicket() {
      return ownsTicket(resource.data)
        && (
          request.resource.data.diff(resource.data).affectedKeys().hasOnly(['unreadStudent'])
          || (
            request.resource.data.diff(resource.data).affectedKeys().hasOnly(['updatedAt', 'unreadAdmin', 'unreadStudent'])
            && request.resource.data.unreadAdmin == true
            && request.resource.data.unreadStudent == false
            && request.resource.data.updatedAt is number
          )
          || (
            resource.data.get('passwordReset', false) == true
            && resource.data.status == 'Gelöst'
            && request.resource.data.passwordReset == false
            && request.resource.data.status == 'Neu'
            && request.resource.data.assignedUid == null
            && request.resource.data.reopened == true
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
              'passwordReset', 'status', 'assignedUid', 'assignedName',
              'updatedAt', 'unreadAdmin', 'unreadStudent', 'reopened'
            ])
          )
        );
    }

    // Ende-zu-Ende-verschlüsselte Passwortdaten:
    // - Nur Admin darf verschlüsselte Pakete anlegen/aktualisieren (niemals Klartext!)
    // - Schüler darf nach Lösung lesen UND nach Nutzung selbst löschen
    match /ticketPasswords/{ticketId} {
      function relatedTicket() {
        return get(/databases/$(database)/documents/tickets/$(ticketId)).data;
      }
      allow read: if isAdmin()
        || (
          signedIn()
          && relatedTicket().uid == request.auth.uid
          && relatedTicket().status == 'Gelöst'
        );
      allow create, update: if isAdmin()
        && request.resource.data.e2ee == true
        && !('password' in request.resource.data)
        && !('username' in request.resource.data);
      allow delete: if isAdmin()
        || (signedIn() && relatedTicket().uid == request.auth.uid);
    }`;

export default function App() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'fallback'>('idle');
  const [rulesCopied, setRulesCopied] = useState<boolean>(false);
  const [showFullCode, setShowFullCode] = useState<boolean>(false);

  const [previewQuery, setPreviewQuery] = useState<string>('');
  const [previewRegStep, setPreviewRegStep] = useState<number>(1);
  const [e2eeStep, setE2eeStep] = useState<E2eeStep>('student-create');
  const [demoPinRevealed, setDemoPinRevealed] = useState<boolean>(false);

  const codeTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const stats = useMemo(() => {
    const lines = CLEAN_PORTAL_HTML.split('\n').length;
    const bytes = new Blob([CLEAN_PORTAL_HTML]).size;
    return {
      lines,
      kb: (bytes / 1024).toFixed(1),
      bytes,
    };
  }, []);

  const filteredDemoItems = useMemo(() => {
    const q = previewQuery.trim().toLowerCase();
    if (!q) return DEMO_ITEMS;
    return DEMO_ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }, [previewQuery]);

  async function handleCopyHtml() {
    try {
      await navigator.clipboard.writeText(CLEAN_PORTAL_HTML);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2600);
    } catch {
      setShowFullCode(true);
      setCopyState('fallback');
      setTimeout(() => {
        const el = codeTextareaRef.current;
        if (el) {
          el.focus();
          el.select();
          try {
            const ok = document.execCommand('copy');
            if (ok) {
              setCopyState('copied');
              setTimeout(() => setCopyState('idle'), 2600);
            }
          } catch {
            // Benutzer kann direkt Strg+C / Cmd+C im markierten Feld drücken
          }
        }
      }, 60);
    }
  }

  function handleDownloadHtml() {
    const blob = new Blob([CLEAN_PORTAL_HTML], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'index.html';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleCopyRules() {
    try {
      await navigator.clipboard.writeText(FIRESTORE_RULES_SNIPPET);
      setRulesCopied(true);
      setTimeout(() => setRulesCopied(false), 2200);
    } catch {
      setRulesCopied(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/80 bg-slate-950/90 sticky top-0 z-30 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Schulportal · Export
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a
              href="#suchleiste"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Suchleiste & Liquid Glass
            </a>
            <a
              href="#e2ee"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Verschlüsselung & Rules
            </a>
            <a
              href="#fehler"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Fehlerbehebungen
            </a>
            <a
              href="#quellcode"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              HTML-Code
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleDownloadHtml}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              index.html laden
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="max-w-6xl mx-auto px-6 py-10 space-y-12">
        <section className="border border-slate-800 rounded-2xl bg-slate-900/50 p-6 sm:p-8 space-y-6">
          <div className="space-y-3 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>Saubere Einzeldatei ohne Proxy-Skript</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {stats.lines.toLocaleString('de-DE')} Zeilen
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{stats.kb} KB</span>
            </div>

            <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-white text-balance">
              Aktualisierter HTML-Code für GitHub & Cloudflare Pages
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Neu gestaltet: die <strong className="text-white">Suchleiste exakt nach eurer Vorlage</strong>, das neue{' '}
              <strong className="text-white">Vollbild-Registrierungsdesign mit 4 Schritten</strong> sowie alle{' '}
              <strong className="text-white">Popups, Hinweise &amp; Toasts im Apple Liquid Glass Design</strong> mit eurem Farbverlauf und den glänzenden Portal-Icons.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleCopyHtml}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
            >
              {copyState === 'copied' ? (
                <>
                  <Check className="w-4 h-4" />
                  Kompletten Code kopiert
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Kompletten HTML-Code kopieren
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadHtml}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-700 hover:border-slate-500 bg-slate-900 text-slate-100 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Als index.html speichern
            </button>

            <button
              type="button"
              onClick={() => setShowFullCode((prev) => !prev)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-800 hover:border-slate-600 text-slate-300 transition-colors cursor-pointer"
            >
              <FileCode2 className="w-4 h-4" />
              {showFullCode ? 'Code-Ansicht schließen' : 'Code hier anzeigen'}
            </button>
          </div>

          {copyState === 'fallback' && (
            <p className="text-xs text-amber-300">
              Direktes Zwischenablage-Schreiben wurde vom Browser-Frame blockiert. Der
              gesamte Code wurde unten markiert — drücke jetzt Strg+C (Windows) oder
              Cmd+C (Mac), oder nutze „Als index.html speichern“.
            </p>
          )}
        </section>

        <section id="suchleiste" className="space-y-8">
          <div className="grid lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-3">
              <h2 className="font-display text-xl font-bold text-white flex items-center gap-2">
                <Search className="w-5 h-5 text-teal-400" />
                Exakte Suchleiste
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Abgestimmt bis ins Pixel auf eure Vorlage: abgerundeter Außenrahmen (
                <code className="text-teal-300">#245259 → #285759</code>,{' '}
                <code className="text-teal-300">1.12rem</code> Radius) mit breitem Rand und tiefpetrolfarbenem Innenfeld (
                <code className="text-teal-300">#193a40 → #1c3d40</code>,{' '}
                <code className="text-teal-300">0.74rem</code> Radius) samt kräftiger weißer Lupe.
              </p>
              <div className="text-xs text-slate-400">
                Live-Test: Tippe ein Wort wie „IServ“ oder „Moodle“ in die Vorschau rechts.
              </div>
            </div>

            <div className="lg:col-span-7 border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/40">
              <div
                className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap"
                style={{
                  background: 'linear-gradient(135deg, #05697a 0%, #497538 100%)',
                }}
              >
                <span className="font-display font-semibold text-white text-sm tracking-tight">
                  Schulportal-Header
                </span>

                <label className="search-pill-outer cursor-text" aria-label="Suchen">
                  <span className="search-pill-inner">
                    <svg
                      className="w-7 h-7 shrink-0 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.75}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="10.2" cy="10.2" r="6.8" />
                      <line x1="15.3" y1="15.3" x2="20.6" y2="20.6" />
                    </svg>
                    <input
                      value={previewQuery}
                      onChange={(e) => setPreviewQuery(e.target.value)}
                      placeholder="Suchen ..."
                      className="bg-transparent outline-none w-32 sm:w-48 focus:w-40 sm:focus:w-56 text-white placeholder-white/65 text-base transition-all"
                    />
                  </span>
                </label>
              </div>

              <div className="divide-y divide-slate-800/80">
                {filteredDemoItems.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-slate-400">
                    Keine passenden Einträge für „{previewQuery}“.
                  </div>
                ) : (
                  filteredDemoItems.map((item) => (
                    <div
                      key={item.title}
                      className="px-5 py-3 flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-slate-200">{item.title}</span>
                      <span className="text-xs text-slate-400 shrink-0">{item.category}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="lg-preview-bg border border-white/20 rounded-3xl p-6 sm:p-8 text-white space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-cyan-200">
                  Apple Liquid Glass Vorschau
                </div>
                <h2 className="font-display text-xl sm:text-2xl font-bold mt-1">
                  Vollbild-Registrierung &amp; alle Popups im Liquid Glass Design
                </h2>
              </div>

              <div className="lg-preview-seg rounded-full p-1 inline-flex gap-1 text-xs font-semibold">
                {[1, 2, 3, 4].map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => setPreviewRegStep(step)}
                    className={`px-3 py-1.5 rounded-full transition cursor-pointer ${
                      previewRegStep === step
                        ? 'bg-white/20 text-white shadow-sm'
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    Schritt {step}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-12 gap-5 items-stretch">
              <div className="md:col-span-5 lg-preview-card rounded-3xl p-5 flex flex-col justify-between gap-4">
                <div className="space-y-4">
                  <div className="text-xs font-semibold text-white/55">
                    Konto erstellen
                  </div>
                  <div className="space-y-3">
                    {[
                      { n: 1, t: 'Schul-E-Mail', d: 'Deine Schuladresse und Kontodaten' },
                      { n: 2, t: 'Passwort', d: 'Lege dein persönliches Passwort fest' },
                      { n: 3, t: 'Hinweise', d: 'Wichtige Hinweise bestätigen' },
                      { n: 4, t: 'Zweite E-Mail', d: 'Optional eine zweite Adresse hinterlegen' },
                    ].map((s) => (
                      <div key={s.n} className="flex items-start gap-3">
                        <span
                          className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${
                            previewRegStep === s.n
                              ? 'bg-[#0a84ff] text-white shadow-sm'
                              : previewRegStep > s.n
                                ? 'bg-white/20 border border-white/30 text-white'
                                : 'bg-white/10 border border-white/15 text-white/55'
                          }`}
                        >
                          {previewRegStep > s.n ? '✓' : s.n}
                        </span>
                        <div>
                          <div className="text-sm font-semibold">{s.t}</div>
                          <div className="text-xs text-white/55">{s.d}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pt-3 border-t border-white/10 text-xs text-white/55">
                  Schritt {previewRegStep} von 4
                </div>
              </div>

              <div className="md:col-span-7 lg-preview-card rounded-3xl p-6 flex flex-col justify-between gap-4">
                <div className="space-y-3">
                  <div className="text-xs font-medium text-white/55">
                    Schritt {previewRegStep} von 4
                  </div>
                  <h3 className="font-display text-2xl font-bold">
                    {previewRegStep === 1 && 'Schul-E-Mail'}
                    {previewRegStep === 2 && 'Medienscouts-Passwort'}
                    {previewRegStep === 3 && 'Hinweise'}
                    {previewRegStep === 4 && 'Zweite E-Mail'}
                  </h3>
                  <p className="text-sm text-white/75 leading-relaxed">
                    {previewRegStep === 1 &&
                      'Eingabe von Schul-E-Mail-Adresse, Vor- und Nachname sowie Klasse/Stufe in ruhigen rauchigen Liquid-Glass-Feldern.'}
                    {previewRegStep === 2 &&
                      'Festlegen und Bestätigen des persönlichen Medienscouts-Passworts (gleichzeitig dein Schlüssel für verschlüsselte Passwort-Resets).'}
                    {previewRegStep === 3 &&
                      'Kurze Bestätigung zu Passwort-Sicherheit und respektvollem Miteinander.'}
                    {previewRegStep === 4 &&
                      'Optionale Angabe einer zweiten E-Mail-Adresse (backupEmail), bevor das Konto direkt erstellt wird.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-white/65">
                    Alle Popups (Video, Mailvorschau, Abmelden, Slash-Befehle, Toasts) nutzen dasselbe ruhige dunkle Liquid-Glass-Finish.
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewRegStep((p) => (p < 4 ? p + 1 : 1))}
                    className="lg-preview-cta px-4 py-2 rounded-xl text-sm font-semibold text-white cursor-pointer shrink-0 hover:brightness-110 transition"
                  >
                    {previewRegStep < 4 ? 'Weiter' : 'Konto erstellen'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="e2ee" className="border border-slate-800 rounded-2xl bg-slate-900/50 p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2 max-w-2xl">
              <h2 className="font-display text-xl font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                Ende-zu-Ende-Verschlüsselung & benötigte Firestore Rules
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Passwörter und Benutzernamen landen niemals im Klartext in Firebase.
                Wichtig: In eurer aktuellen <code className="text-amber-300">firestore.rules</code>{' '}
                darf aktuell nur der Admin <code className="text-amber-300">ticketPasswords</code>{' '}
                löschen — bitte ergänzt dort auch das Löschrecht für den Ticketinhaber.
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setE2eeStep('student-create')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  e2eeStep === 'student-create'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                1. Medienscouts-Passwort bestätigen
              </button>
              <button
                type="button"
                onClick={() => setE2eeStep('admin-send')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  e2eeStep === 'admin-send'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                2. Admin sendet verschlüsselt
              </button>
              <button
                type="button"
                onClick={() => setE2eeStep('student-decrypt')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  e2eeStep === 'student-decrypt'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                3. Chat-Entschlüsselung
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6 pt-2 items-start">
            <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
              {e2eeStep === 'student-create' && (
                <>
                  <div className="font-semibold text-white">
                    Schüler bestätigt sein Medienscouts-Passwort
                  </div>
                  <p>
                    Statt eines extra Codes gibt der Schüler einmal sein Login-Passwort
                    für diese Medienscouts-Webseite ein. Firebase Auth prüft sofort per{' '}
                    <code className="text-emerald-300">reauthenticateWithCredential</code>,
                    dass kein Tippfehler vorliegt. Damit schützt der Browser den privaten
                    Schlüssel – Verwechslungen mit der App „Schulportal“ sind ausgeschlossen.
                  </p>
                </>
              )}

              {e2eeStep === 'admin-send' && (
                <>
                  <div className="font-semibold text-white">
                    Admin verschlüsselt im Browser vor dem Speichern
                  </div>
                  <p>
                    Über <code className="text-emerald-300">/passwort</code> oder den
                    Button „Passwort verschlüsselt senden“ im Chat verschlüsselt der Browser
                    des Admins Benutzername und Passwort per AES-256-GCM und verpackt den
                    Sitzungsschlüssel mit dem öffentlichen Schlüssel des Schülers.
                  </p>
                </>
              )}

              {e2eeStep === 'student-decrypt' && (
                <>
                  <div className="font-semibold text-white">
                    Sichtbarer E2EE-Banner & Entschlüsselung per Medienscouts-Passwort
                  </div>
                  <p>
                    Im Ticket-Chat zeigt ein Banner dauerhaft „Ende-zu-Ende-verschlüsselt“
                    an. Der Schüler gibt zum Entsperren einfach sein gewohntes
                    Medienscouts-Passwort ein. Mit „Nach Nutzung endgültig löschen“ wird das
                    Dokument aus Firebase entfernt.
                  </p>
                </>
              )}
            </div>

            <div className="border border-slate-800 rounded-xl bg-slate-950 overflow-hidden">
              <div className="bg-emerald-950/60 border-b border-emerald-500/30 px-4 py-2 text-xs text-emerald-300 font-medium flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Ende-zu-Ende-verschlüsselt · Niemals im Klartext in Firebase gespeichert
                </span>
              </div>

              <div className="p-4 space-y-3 text-sm">
                {e2eeStep === 'student-create' && (
                  <div className="space-y-2">
                    <div className="text-xs text-slate-400">
                      Ticket-Dokument in Firestore (tickets/…)
                    </div>
                    <pre className="text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
{`e2eeVersion: 1
e2eePublicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..."
e2eeWrappedPrivateKey: {
  alg: "PBKDF2-SHA256+AES-256-GCM",
  iterations: 310000,
  ciphertext: "x9P4mQ8r..."
}`}
                    </pre>
                  </div>
                )}

                {e2eeStep === 'admin-send' && (
                  <div className="space-y-2.5">
                    <div className="font-semibold text-white">
                      Zugangsdaten verschlüsselt gesendet
                    </div>
                    <div className="rounded bg-black h-6 w-48 border border-slate-800" />
                    <p className="text-xs text-slate-400">
                      In <code className="text-slate-300">ticketPasswords</code> liegen nur{' '}
                      <code className="text-slate-300">encryptedKey</code>,{' '}
                      <code className="text-slate-300">iv</code> und{' '}
                      <code className="text-slate-300">encryptedPayload</code>.
                    </p>
                  </div>
                )}

                {e2eeStep === 'student-decrypt' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        Entschlüsselte Zugangsdaten
                      </span>
                      <span className="text-xs text-emerald-400">Lokal im Browser</span>
                    </div>
                    <div className="text-xs space-y-1 text-slate-300">
                      <div>
                        App: <strong className="text-white">IServ</strong>
                      </div>
                      <div>
                        Benutzername: <strong className="text-white">max.mustermann</strong>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>Passwort:</span>
                        <strong className="font-mono text-white">
                          {demoPinRevealed ? 'Schule-2026!' : '••••••••••••'}
                        </strong>
                        <button
                          type="button"
                          onClick={() => setDemoPinRevealed((prev) => !prev)}
                          className="text-slate-400 hover:text-white p-1 cursor-pointer"
                          aria-label="Vorschau-Passwort umschalten"
                        >
                          {demoPinRevealed ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm font-medium text-white">
                Aktualisierte Stellen für eure <code className="text-teal-300">firestore.rules</code>
              </div>
              <button
                type="button"
                onClick={handleCopyRules}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 hover:border-slate-500 text-slate-200 transition-colors cursor-pointer"
              >
                {rulesCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {rulesCopied ? 'Rules-Ausschnitt kopiert' : 'Rules-Ausschnitt kopieren'}
              </button>
            </div>
            <pre className="text-xs font-mono bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-300 overflow-x-auto leading-relaxed">
              {FIRESTORE_RULES_SNIPPET}
            </pre>
          </div>
        </section>

        <section id="fehler" className="space-y-4">
          <h2 className="font-display text-xl font-bold text-white flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-400" />
            Prüfergebnisse & behobene Fehler
          </h2>

          <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/40">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-400 bg-slate-900/80">
                    <th className="py-3 px-4 font-semibold">Bereich</th>
                    <th className="py-3 px-4 font-semibold">Befund</th>
                    <th className="py-3 px-4 font-semibold">Lösung im Code</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {FIXED_BUGS.map((bug) => (
                    <tr key={bug.area} className="hover:bg-slate-900/70 transition-colors">
                      <td className="py-3 px-4 font-medium text-white align-top whitespace-nowrap">
                        {bug.area}
                      </td>
                      <td className="py-3 px-4 text-slate-300 align-top">{bug.cause}</td>
                      <td className="py-3 px-4 text-emerald-300 align-top">{bug.fix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="quellcode" className="border border-slate-800 rounded-2xl bg-slate-900/50 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="font-display text-lg font-bold text-white">
                Vollständiger HTML-Quellcode
              </h2>
              <p className="text-xs text-slate-400">
                Saubere Ausgabe mit {stats.lines.toLocaleString('de-DE')} Zeilen (ohne{' '}
                <code className="text-slate-300">_aistudio-iframe.js</code>).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyHtml}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
              >
                {copyState === 'copied' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Kopiert
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Alles kopieren
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowFullCode((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 hover:border-slate-500 text-slate-200 transition-colors cursor-pointer"
              >
                {showFullCode ? 'Ausblenden' : 'Quellcode einblenden'}
              </button>
            </div>
          </div>

          {showFullCode && (
            <textarea
              ref={codeTextareaRef}
              readOnly
              value={CLEAN_PORTAL_HTML}
              onClick={(e) => e.currentTarget.select()}
              spellCheck={false}
              aria-label="Kompletter HTML-Quellcode des Schulportals"
              className="w-full h-96 rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs text-slate-200 focus:outline-none focus:border-teal-500"
            />
          )}
        </section>
      </main>
    </div>
  );
}
