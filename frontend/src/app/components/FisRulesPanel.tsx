import type { ReactNode } from 'react';
import { ArrowRight, BedSingle, BookOpen, Check, CircleHelp, ClipboardCheck, Coins, Flag, Hotel, Info, Lightbulb, MountainSnow, ShieldCheck, Snowflake, UserRound, Users, X } from 'lucide-react';
import './FisRulesPanel.css';

// Editorial reference only. Runtime event mappings and quota services remain authoritative.
const sports = [
  { name: 'Snowboard', groups: [
    { name: 'Snowboard Alpine', events: ['Parallel Giant Slalom M/W', 'Parallel Slalom M/W', 'Mixed Parallel Team'] },
    { name: 'Snowboard Park & Pipe', events: ['Halfpipe M/W', 'Big Air M/W', 'Slopestyle M/W'] },
    { name: 'Snowboard Cross', events: ['Snowboard Cross M/W', 'Mixed Snowboard Cross Team'] },
  ] },
  { name: 'Freeski', groups: [{ name: 'Freeski Park & Pipe', events: ['Halfpipe M/W', 'Big Air M/W', 'Slopestyle M/W'] }] },
  { name: 'Freestyle Ski', groups: [
    { name: 'Freestyle', events: ['Moguls M/W', 'Dual Moguls M/W', 'Dual Moguls Team', 'Aerials M/W', 'Aerials Team'] },
    { name: 'Ski Cross', events: ['Ski Cross M/W', 'Ski Cross Team'] },
  ] },
];
const faq = [
  ['Warum hat dieses EZ keinen Mehrpreis?', 'Weil die EZ-Nutzung regulär abgedeckt ist oder bewusst nicht als EZ gewertet wird.'],
  ['Warum steht +EZ offen, aber Mehrpreis noch auf Nein?', 'Weil die Genehmigung noch nicht erteilt wurde. Bei Sondertarif kann unabhängig davon bereits Mehrpreis angezeigt werden.'],
  ['Warum hat ein DZ Mehrpreis?', 'Möglich wegen Sondertarif – unabhängig von der Zimmerart. Auch eine als EZ gewertete DZ-Belegung mit genehmigter zusätzlicher EZ-Nutzung kann Mehrpreis auslösen.'],
  ['Warum sehe ich die Person nicht in der Dispo?', 'Möglicherweise: No room. Die Person bleibt im Event, hat aber keinen offenen Unterkunftsbedarf.'],
];
const references = [
  ['9.1.3', 'Officials'], ['9.1.5', 'President / Secretary General'],
  ['9.1.7', 'Extra Officials / Special Guests'], ['13.1', 'Accommodation pricing'],
  ['13.2', 'Extra Officials / Special Guests pricing'], ['13.3', 'Accommodation / Single Rooms'],
];

function Section({ number, title, children, className = '' }: { number: number; title: string; children: ReactNode; className?: string }) {
  return <section className={`fis-section ${className}`} aria-labelledby={`fis-section-${number}`}>
    <h2 id={`fis-section-${number}`}><span className="fis-number">{number}</span>{title}</h2>{children}
  </section>;
}
function Arrow() { return <ArrowRight className="fis-arrow" aria-hidden="true" />; }
function Note({ children }: { children: ReactNode }) { return <p className="fis-note"><Info aria-hidden="true" /> <span>{children}</span></p>; }
function Figure({ kind, count = 1 }: { kind: 'athlete' | 'official' | 'bed'; count?: number }) {
  return <span className={`fis-figures fis-figures--${kind}`} aria-hidden="true">{Array.from({ length: count }, (_, i) => kind === 'bed'
    ? <BedSingle key={i} /> : <span className="fis-person" key={i}><UserRound />{kind === 'athlete' ? <Snowflake /> : <ClipboardCheck />}</span>)}</span>;
}

export function FisRulesPanel() {
  return <div className="fis-guide-scroll"><article className="fis-guide" aria-labelledby="fis-title">
    <header className="fis-masthead">
      <div><p className="fis-eyebrow"><BookOpen aria-hidden="true" /> FIS Rules · Disposition kompakt</p>
        <h1 id="fis-title">FIS Unterkunft &amp; Quoten <span>– einfach erklärt</span></h1>
        <p>Wie Officials, EZ-Quote, Mehrpreis und Unterkunft zusammenhängen.</p>
        <small>Operativer Leitfaden · FIS-Regeln und aktuelle Anwendung getrennt erklärt</small>
      </div>
      <div className="fis-landscape" aria-hidden="true"><MountainSnow /><Hotel /></div>
    </header>
    <div className="fis-poster">
      <Section number={1} title="Quotenkontext" className="fis-half">
        <p className="fis-context"><Flag aria-hidden="true" /> Nation <b>+</b> Event Group <b>+</b> Gender <b>=</b> Quotenkontext</p>
        <div className="fis-flow fis-quota-flow">
          <div><strong>4 Athleten</strong><Figure kind="athlete" count={4} /></div><Arrow />
          <div><strong>+ 2 → 6 Officials</strong><Figure kind="official" count={3} /><small>Officials-Basis</small></div><Arrow />
          <div><strong>2 EZ erlaubt</strong><Figure kind="bed" count={2} /></div>
        </div>
        <div className="fis-rule-strip"><b>Athleten + 2 = Officials-Quote</b><span>1–3 Officials → 1 EZ · 4–6 → 2 EZ · ab 7 → 3 EZ</span><small>FIS 9.1.3 · 13.3</small></div>
        <Note>Die Quote gilt je Nation + Event Group + Gender. Ohne gemeldete Athleten entsteht in der Anwendung keine reguläre Quote.</Note>
      </Section>
      <Section number={2} title="Wichtigster Merksatz" className="fis-half">
        <p className="fis-key"><Lightbulb aria-hidden="true" />Ein EZ bedeutet <em>nicht automatisch</em> Mehrpreis.</p>
        <div className="fis-decision-start"><BedSingle aria-hidden="true" /><div><b>Person wird als EZ gewertet</b><small>countsAsSingle = true</small></div><Arrow /><b>Regulär abgedeckt?</b></div>
        <div className="fis-branches">
          <div className="fis-outcome fis-ok"><Check aria-hidden="true" /><div><b>Ja → IN QUOTA</b><span>Kein EZ-Mehrpreis</span></div></div>
          <div className="fis-outcome fis-pending"><ClipboardCheck aria-hidden="true" /><div><b>Nein → Genehmigung erforderlich</b><span>+EZ offen · noch kein EZ-Mehrpreis</span><small>PENDING_APPROVAL</small></div></div>
        </div>
        <div className="fis-approval"><Arrow /><ShieldCheck aria-hidden="true" /><span>Nach Genehmigung · <code>APPROVED_EXTRA</code></span><b>Mehrpreis JA</b><Coins aria-hidden="true" /></div>
        <Note>EZ-Mehrpreis braucht beides: genehmigte zusätzliche EZ-Nutzung und countsAsSingle = true. Sondertarif ist ein eigener Grund.</Note>
      </Section>
      <Section number={3} title="Konkretes Beispiel" className="fis-full">
        <div className="fis-example">
          <div className="fis-example-equation"><div><Figure kind="athlete" count={4} /><b>4 Athleten</b></div><span>+ 2</span><div><Figure kind="official" count={3} /><b>Officials-Basis = 6</b></div><Arrow /><div><Figure kind="bed" count={2} /><b>2 EZ erlaubt</b></div></div>
          <div className="fis-example-rows">
            <ExampleRow name="Person A im EZ" used={1} label="1 / 2 genutzt" result="Kein Mehrpreis" />
            <ExampleRow name="Person B im EZ" used={2} label="2 / 2 genutzt" result="Kein Mehrpreis" />
            <ExampleRow name="Zusätzliche EZ-Nutzung" used={3} label="Quote überschritten" result="Genehmigung erforderlich → nach Genehmigung EZ-Mehrpreis" />
          </div>
        </div>
        <Note>Konzeptbeispiel, keine Vergabereihenfolge: Die Zuteilung erfolgt nach zulässigen Quotenkontexten und stabilen Schlüsseln, nicht nach dem Zeitpunkt der Zuweisung. Athleten und Officials können regulär abgedeckt sein.</Note>
      </Section>
      <Section number={4} title="DZ-Wunsch, aber im EZ untergebracht" className="fis-third">
        <div className="fis-room-scene"><BedSingle aria-hidden="true" /><div><b>Wunsch: DZ</b><span>Untergebracht: physisches EZ</span></div></div>
        <div className="fis-outcome fis-ok"><Check aria-hidden="true" /><div><b>Als EZ werten = true</b><small>countsAsSingle = true</small><span>Zählt zur EZ-Bewertung; ggf. Genehmigung und EZ-Mehrpreis.</span></div></div>
        <div className="fis-outcome"><X aria-hidden="true" /><div><b>Als EZ werten = false</b><small>countsAsSingle = false</small><span>Keine EZ-Quotenbelastung; kein EZ-Mehrpreis aus dieser Belegung.</span></div></div>
        <Note>Zimmerart und EZ-Bewertung sind zwei verschiedene Dinge. Ein physisches EZ wird standardmäßig als EZ gewertet; false ist eine bewusste manuelle Änderung.</Note>
      </Section>
      <Section number={5} title="Diese Dinge nicht vermischen" className="fis-third">
        <p>Diese Ebenen werden getrennt betrachtet.</p>
        <div className="fis-layers">
          <Layer icon={<Users />} title="Person / Quote" items={['Athlete', 'Official', 'Extra Official', 'Special Guest']} />
          <Layer icon={<Hotel />} title="Unterkunft" items={['Required', 'No room', 'External']} />
          <Layer icon={<Coins />} title="Tarif" items={['Standard', 'Sondertarif']} />
          <Layer icon={<BedSingle />} title="EZ-Bewertung" items={['Als EZ werten', 'Nicht als EZ werten']} />
        </div>
        <Note>FIS-Kategorien sind keine automatischen Function-Zuordnungen. Auch Unterkunftsbedarf und Unterkunftsort sind verschiedene Angaben.</Note>
      </Section>
      <Section number={6} title="Wenn du dich fragst …" className="fis-third">
        <dl className="fis-faq">{faq.map(([q, a]) => <div key={q}><dt><CircleHelp aria-hidden="true" />{q}</dt><dd>{a}</dd></div>)}</dl>
      </Section>
      <Section number={7} title="Was ist eine Event Group?" className="fis-half fis-extended">
        <p>Event Groups bündeln einzelne Wettbewerbe für die Quotenbetrachtung.</p>
        <div className="fis-sports">{sports.map(sport => <div key={sport.name}><h3><MountainSnow aria-hidden="true" />{sport.name}</h3>{sport.groups.map(group => <details key={group.name} className="fis-group"><summary><Snowflake aria-hidden="true" />{group.name}</summary><ul>{group.events.map(event => <li key={event}>{event}</li>)}</ul></details>)}</div>)}</div>
        <Note>M/W = Männer / Frauen. Mixed- und Teamwettbewerbe sind Wettbewerbsnamen; sie bilden keinen zusätzlichen Gender-Quotenpool.</Note>
      </Section>
      <Section number={8} title="Welche Officials-Arten gibt es?" className="fis-half fis-extended">
        <p>FIS-Kategorien als Referenz · keine automatische Klassifizierung in der Anwendung</p>
        <ul className="fis-officials">{[
          ['Regular Officials', 'Normale Officials-Quote'], ['Extra Officials', 'Zusätzliche FIS-Kategorie'],
          ['Special Guests', 'Separate FIS-Kategorie'], ['President / Secretary General', 'Zählen nicht zur normalen Officials-Quote'],
          ['Service Personnel', 'Separat geregelt'],
        ].map(([name, description]) => <li key={name}><Figure kind="official" /><div><b>{name}</b><span>{description}</span></div></li>)}</ul>
        <Note>Die importierte Function ist nicht automatisch identisch mit der FIS-Kategorie. Insbesondere: NSA Guest ≠ automatisch Special Guest. FIS 9.1.5 · 9.1.7.</Note>
      </Section>
      <Section number={9} title="Sonderfälle" className="fis-full">
        <div className="fis-specials"><div><Coins aria-hidden="true" /><h3>Sondertarif</h3><p>Unabhängig von EZ oder DZ. Bei bestehendem Unterkunftsbedarf ist SPECIAL ein eigener Mehrpreisgrund.</p></div>
          <div><UserRound aria-hidden="true" /><h3>No room</h3><p>Person bleibt im Event und in den Statistiken, benötigt aber keine Unterkunft. Mehrpreis: nicht anwendbar (—).</p></div>
          <div><Hotel aria-hidden="true" /><h3>External</h3><p>Unterkunft vorhanden, aber außerhalb der normalen LOC-Disposition.</p></div></div>
        <p className="fis-distinction"><b>No room ≠ External</b><b>Sondertarif ≠ EZ-Mehrpreis</b></p>
      </Section>
      <Section number={10} title="Quellen / FIS Rules" className="fis-full fis-sources">
        <p><BookOpen aria-hidden="true" /><b>FIS Rules for the Organisation of FIS World Championships</b><span>Fassung 19.03.2023</span></p>
        <ul>{references.map(([article, label]) => <li key={article} data-fis-reference={article}><b>{article}</b> — {label}</li>)}</ul>
        <small>Referenzen ohne hinterlegte Online-Links. FIS-Regeltext, aktuelle Anwendungslogik und organisatorische Entscheidungen sind zu unterscheiden. Art. 13.3 bemisst die EZ-Anzahl nach Officials; er nennt keine ausdrückliche Beschränkung der Belegung auf Officials.</small>
      </Section>
    </div>
    <footer className="fis-bottom"><Lightbulb aria-hidden="true" /><b>Merke:</b> Zimmerart, EZ-Quote, Mehrpreis und Tarif sind verbunden – aber nicht dasselbe.</footer>
  </article></div>;
}
function ExampleRow({ name, used, label, result }: { name: string; used: number; label: string; result: string }) {
  return <div className={`fis-example-row ${used > 2 ? 'fis-pending' : 'fis-ok'}`}><span><UserRound aria-hidden="true" />{name}</span><div><span className="fis-meter" role="img" aria-label={`${label}, 2 EZ erlaubt`}><i style={{ width: `${Math.min(used / 2, 1) * 100}%` }} /></span><small>{label}</small></div><b>{used > 2 ? <ClipboardCheck aria-hidden="true" /> : <Check aria-hidden="true" />}{result}</b></div>;
}
function Layer({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return <div><span aria-hidden="true">{icon}</span><h3>{title}</h3><ul>{items.map(item => <li key={item}>{item}</li>)}</ul></div>;
}
