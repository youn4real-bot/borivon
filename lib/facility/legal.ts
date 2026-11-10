/**
 * Nutzungsbedingungen + AVV of the facility platform (Stand 10.11.2026, TERMS_VERSION in db.ts).
 * B2B only. The free scope (5 nurses, 2 users, unbefristet) is stated in § 3, as the founder asked:
 * the marketing says "kostenloser Zugang", the contract says exactly what it covers.
 * Change a word here → bump TERMS_VERSION (acceptances are stored with the version).
 */
import { FREE_NURSES, FREE_USERS } from "./db";

export type LegalDoc = { title: string; stand: string; intro?: string; sections: { h: string; p: string[] }[] };

const PROVIDER = "Borivon LLC, 30 N Gould St Ste R, Sheridan, WY 82801, USA, E-Mail: contact@borivon.com (siehe Impressum)";

export const TERMS: LegalDoc = {
  title: "Nutzungsbedingungen der Borivon-Plattform",
  stand: "Stand: 10. November 2026",
  sections: [
    { h: "§ 1 Anbieter und Geltungsbereich", p: [
      `Die Borivon-Plattform unter borivon.com/einrichtung (die „Plattform“) wird betrieben von der ${PROVIDER} („Borivon“).`,
      "Diese Nutzungsbedingungen gelten für die Nutzung der Plattform durch Gesundheitseinrichtungen und ihre Träger („Einrichtung“). Die Plattform richtet sich ausschließlich an Unternehmer im Sinne von § 14 BGB, nicht an Verbraucher.",
      "Abweichende Bedingungen der Einrichtung gelten nicht, auch wenn Borivon ihnen nicht ausdrücklich widerspricht.",
    ] },
    { h: "§ 2 Leistungen", p: [
      "Die Plattform hilft der Einrichtung, die Ankunft von Pflegekräften aus dem Ausland zu organisieren. Sie erstellt für jede eingetragene Pflegekraft einen Ankunftsplan mit typischen ersten Schritten in Deutschland, zeigt dazu automatisch nahegelegene Stellen (z. B. Bürgerbüro, Bank, Krankenkasse, Finanzamt, Ausländerbehörde, Hausarztpraxis) auf einer Karte und erlaubt, den Plan über einen persönlichen Link mit der jeweiligen Pflegekraft zu teilen.",
      "Die Ortsangaben stammen automatisch aus OpenStreetMap (© OpenStreetMap-Mitwirkende, ODbL). Borivon prüft sie nicht einzeln und übernimmt keine Gewähr für ihre Richtigkeit, Vollständigkeit oder dafür, dass die angezeigte Stelle im Einzelfall zuständig ist. Die Hinweise in den Ankunftsplänen sind allgemeine Informationen und keine Rechtsberatung. Behördengänge, Fristen und Anträge bleiben Sache der Einrichtung und der Pflegekraft.",
      "Borivon darf die Plattform weiterentwickeln und einzelne Funktionen ändern, sofern der Kern der Leistung nach Absatz 1 erhalten bleibt.",
    ] },
    { h: "§ 3 Kostenloser Umfang", p: [
      `Die Nutzung ist kostenlos und unbefristet im folgenden Umfang: je Einrichtung bis zu ${FREE_NURSES} (${FREE_NURSES === 5 ? "fünf" : FREE_NURSES}) eingetragene Pflegekräfte gleichzeitig und bis zu ${FREE_USERS} (${FREE_USERS === 2 ? "zwei" : FREE_USERS}) Nutzer. Das von Borivon angelegte Beispiel zählt nicht mit.`,
      "Eine Nutzung über diesen Umfang hinaus ist nur nach gesonderter Vereinbarung möglich. Borivon kann dafür künftig kostenpflichtige Erweiterungen anbieten; der kostenlose Umfang nach Satz 1 bleibt davon unberührt.",
      "Ein Anspruch auf Abschluss eines Nutzungsvertrags besteht nicht. Der Zugang wird über einen persönlichen Link aus dem Fahrplan von Borivon eröffnet.",
    ] },
    { h: "§ 4 Zugang und Nutzer", p: [
      "Jeder Nutzer meldet sich mit seiner eigenen E-Mail-Adresse über einen einmal gültigen Link an. Die Einrichtung sorgt dafür, dass nur ihre berechtigten Mitarbeitenden Zugang erhalten, hält die Anmelde-Links vertraulich und informiert Borivon unverzüglich, wenn ein Missbrauch zu befürchten ist.",
      "Die Einrichtung ist für die Handlungen ihrer Nutzer auf der Plattform verantwortlich.",
    ] },
    { h: "§ 5 Pflichten der Einrichtung", p: [
      "Die Einrichtung trägt nur Daten ein, die sie rechtmäßig verarbeiten darf, und nur so viele, wie für den Ankunftsplan nötig sind. Sie ist für die von ihr eingetragenen personenbezogenen Daten Verantwortliche im Sinne der DSGVO und informiert die betroffenen Pflegekräfte nach Art. 13 und 14 DSGVO.",
      "Den persönlichen Link eines Plans gibt die Einrichtung nur der jeweiligen Pflegekraft weiter.",
      "Die Plattform darf nicht missbräuchlich genutzt werden, insbesondere nicht für rechtswidrige Inhalte, automatisierte Massenabfragen oder Versuche, Sicherheitsmaßnahmen zu umgehen.",
    ] },
    { h: "§ 6 Verfügbarkeit", p: [
      "Borivon bemüht sich um eine möglichst unterbrechungsfreie Verfügbarkeit, schuldet aber keine bestimmte Verfügbarkeit. Wartungsarbeiten und Störungen, die Borivon nicht zu vertreten hat (z. B. bei Dienstleistern oder Datenquellen), können die Nutzung zeitweise einschränken.",
    ] },
    { h: "§ 7 Haftung", p: [
      "Da die Leistung unentgeltlich erbracht wird, haftet Borivon nur für Vorsatz und grobe Fahrlässigkeit.",
      "Unberührt bleiben die Haftung für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit, die Haftung nach dem Produkthaftungsgesetz, bei arglistig verschwiegenen Mängeln sowie die Haftung nach Art. 82 DSGVO.",
    ] },
    { h: "§ 8 Laufzeit und Kündigung", p: [
      "Der Nutzungsvertrag läuft auf unbestimmte Zeit. Die Einrichtung kann ihn jederzeit beenden, indem sie ihren Zugang auf der Plattform löscht (unter „Einrichtung“) oder Borivon in Textform kündigt.",
      "Borivon kann den Vertrag mit einer Frist von drei Monaten in Textform kündigen. Das Recht zur außerordentlichen Kündigung aus wichtigem Grund, etwa bei Missbrauch nach § 5, bleibt unberührt.",
      "Nach Vertragsende löscht Borivon die Daten der Einrichtung innerhalb von 30 Tagen, soweit keine gesetzliche Aufbewahrungspflicht besteht. Löscht die Einrichtung ihren Zugang selbst, werden die Daten sofort gelöscht.",
    ] },
    { h: "§ 9 Datenschutz", p: [
      "Für die personenbezogenen Daten der Pflegekräfte, die die Einrichtung einträgt, verarbeitet Borivon diese im Auftrag der Einrichtung. Dafür gilt der Vertrag zur Auftragsverarbeitung (AVV) unter borivon.com/einrichtung/avv, den die Einrichtung bei Eröffnung des Zugangs abschließt.",
      "Für die Daten der Nutzer selbst gilt die Datenschutzerklärung unter borivon.com/datenschutz.",
    ] },
    { h: "§ 10 Änderungen dieser Bedingungen", p: [
      "Borivon kann diese Nutzungsbedingungen mit Wirkung für die Zukunft ändern, wenn ein sachlicher Grund besteht (z. B. neue Funktionen, Rechtsänderungen). Borivon teilt Änderungen mindestens sechs Wochen vor ihrem Inkrafttreten per E-Mail mit. Widerspricht die Einrichtung nicht bis zum Inkrafttreten, gelten die Änderungen als angenommen; darauf weist Borivon in der Mitteilung hin. Widerspricht die Einrichtung, können beide Seiten den Vertrag zum Inkrafttreten der Änderung kündigen.",
      "Der kostenlose Umfang nach § 3 wird nicht über diesen Weg verringert.",
    ] },
    { h: "§ 11 Schlussbestimmungen", p: [
      "Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts.",
      "Sollte eine Bestimmung unwirksam sein, bleibt der Vertrag im Übrigen wirksam. An die Stelle der unwirksamen Bestimmung tritt die gesetzliche Regelung.",
    ] },
  ],
};

export const AVV: LegalDoc = {
  title: "Vertrag zur Auftragsverarbeitung (AVV)",
  stand: "Stand: 10. November 2026 · nach Art. 28 DSGVO",
  intro: `zwischen der Einrichtung, die den Zugang zur Borivon-Plattform eröffnet („Verantwortlicher“), und der ${PROVIDER} („Auftragsverarbeiter“). Der Vertrag wird elektronisch geschlossen, indem die Einrichtung ihm bei der Eröffnung des Zugangs zustimmt (Art. 28 Abs. 9 DSGVO).`,
  sections: [
    { h: "1. Gegenstand und Dauer", p: [
      "Der Auftragsverarbeiter verarbeitet personenbezogene Daten im Auftrag des Verantwortlichen, um die Borivon-Plattform nach den Nutzungsbedingungen bereitzustellen. Der Vertrag gilt, solange der Nutzungsvertrag besteht, und darüber hinaus, bis alle Daten nach Ziffer 11 gelöscht sind.",
    ] },
    { h: "2. Art und Zweck der Verarbeitung", p: [
      "Speichern, Anzeigen, Ändern und Löschen der eingetragenen Daten; Erstellen der Ankunftspläne; Ermitteln nahegelegener Stellen anhand der Postleitzahl und des Ortes; Bereitstellen des persönlichen Links für die Pflegekraft; Versand von Anmelde- und Einladungs-E-Mails an Nutzer.",
    ] },
    { h: "3. Art der Daten und betroffene Personen", p: [
      "Pflegekräfte des Verantwortlichen: Vor- und Nachname, Herkunftsland, Ankunftsdatum, erster Arbeitstag, Postleitzahl und Ort der Wohnung, Stand der Schritte im Ankunftsplan.",
      "Nutzer des Verantwortlichen: E-Mail-Adresse, Anrede und Nachname (soweit angegeben), Zeitpunkt der letzten Anmeldung.",
      "Besondere Kategorien personenbezogener Daten (Art. 9 DSGVO), Ausweisdaten und Bankdaten werden auf der Plattform nicht abgefragt und sollen nicht eingetragen werden.",
    ] },
    { h: "4. Weisungen", p: [
      "Der Auftragsverarbeiter verarbeitet die Daten nur auf dokumentierte Weisung des Verantwortlichen, es sei denn, er ist gesetzlich zu einer Verarbeitung verpflichtet; dann teilt er dies vorher mit, soweit das Gesetz es nicht verbietet. Weisungen sind die Nutzung der Plattformfunktionen durch den Verantwortlichen sowie Weisungen in Textform.",
      "Hält der Auftragsverarbeiter eine Weisung für rechtswidrig, informiert er den Verantwortlichen unverzüglich.",
    ] },
    { h: "5. Vertraulichkeit", p: [
      "Der Auftragsverarbeiter setzt nur Personen ein, die zur Vertraulichkeit verpflichtet sind oder einer gesetzlichen Verschwiegenheitspflicht unterliegen, und nur soweit es für die Leistung nötig ist.",
    ] },
    { h: "6. Technische und organisatorische Maßnahmen", p: [
      "Der Auftragsverarbeiter trifft die Maßnahmen nach Art. 32 DSGVO, insbesondere: Übertragung nur verschlüsselt (TLS); Zugriff auf die Daten einer Einrichtung nur nach Anmeldung eines ihrer Nutzer; Anmelde-Links einmalig und befristet, Sitzungen befristet; gespeichert werden nur Prüfsummen (Hashes) von Anmelde- und Sitzungsschlüsseln; persönliche Links der Pflegekräfte sind lange Zufallswerte und werden mit dem Datensatz ungültig; Datenbank bei Cloudflare in der EU; nach außen geht zur Ortssuche nur die Postleitzahl mit dem Ort, nie ein Name; Kartenbilder werden über den Server des Auftragsverarbeiters geladen; Zugriffsrechte nach dem Prinzip der geringsten Berechtigung; regelmäßige Überprüfung der Maßnahmen.",
      "Der Auftragsverarbeiter darf die Maßnahmen weiterentwickeln, solange das Schutzniveau nicht sinkt.",
    ] },
    { h: "7. Unterauftragsverarbeiter", p: [
      "Der Verantwortliche genehmigt allgemein den Einsatz weiterer Auftragsverarbeiter. Derzeit eingesetzt: Cloudflare, Inc. (Hosting, Datenbank; Speicherung in der EU) und Resend, Inc. (Versand der Anmelde- und Einladungs-E-Mails; verarbeitet nur E-Mail-Adressen der Nutzer).",
      "Der Auftragsverarbeiter informiert den Verantwortlichen vorab per E-Mail über jede beabsichtigte Änderung; der Verantwortliche kann innerhalb von 14 Tagen widersprechen und im Fall des Widerspruchs den Nutzungsvertrag kündigen. Der Auftragsverarbeiter verpflichtet jeden Unterauftragsverarbeiter vertraglich auf die Pflichten dieses Vertrags.",
    ] },
    { h: "8. Übermittlung in Drittländer", p: [
      "Der Auftragsverarbeiter hat seinen Sitz in den USA. Soweit dadurch oder durch Unterauftragsverarbeiter Daten in ein Drittland übermittelt werden, geschieht dies nur unter den Voraussetzungen der Art. 44 ff. DSGVO. Hierfür vereinbaren die Parteien die Standardvertragsklauseln der Europäischen Kommission (Durchführungsbeschluss (EU) 2021/914, Modul 2: Verantwortlicher an Auftragsverarbeiter), die durch Verweis Bestandteil dieses Vertrags sind; die Angaben für ihre Anhänge ergeben sich aus diesem Vertrag. Bei Unterauftragsverarbeitern stützt sich die Übermittlung auf deren Zertifizierung nach dem EU-US Data Privacy Framework oder auf Standardvertragsklauseln.",
    ] },
    { h: "9. Unterstützung des Verantwortlichen", p: [
      "Der Auftragsverarbeiter unterstützt den Verantwortlichen mit geeigneten Maßnahmen bei der Erfüllung der Rechte betroffener Personen (Art. 12 bis 23 DSGVO) sowie bei den Pflichten nach Art. 32 bis 36 DSGVO. Die meisten Rechte kann der Verantwortliche direkt auf der Plattform erfüllen (Ändern und Löschen der Daten).",
    ] },
    { h: "10. Verletzungen des Schutzes personenbezogener Daten", p: [
      "Der Auftragsverarbeiter meldet dem Verantwortlichen eine Verletzung des Schutzes personenbezogener Daten unverzüglich, möglichst innerhalb von 48 Stunden nach Bekanntwerden, mit den Angaben nach Art. 33 Abs. 3 DSGVO, soweit sie vorliegen.",
    ] },
    { h: "11. Löschung und Rückgabe", p: [
      "Nach Ende des Nutzungsvertrags löscht der Auftragsverarbeiter alle Daten des Verantwortlichen innerhalb von 30 Tagen, soweit keine gesetzliche Pflicht zur Speicherung besteht. Vorher stellt er dem Verantwortlichen auf Wunsch die Daten in einem gängigen Format bereit. Löscht der Verantwortliche seinen Zugang selbst, werden die Daten sofort gelöscht.",
    ] },
    { h: "12. Nachweise und Kontrollen", p: [
      "Der Auftragsverarbeiter stellt dem Verantwortlichen alle Informationen zur Verfügung, die zum Nachweis der Einhaltung dieses Vertrags nötig sind, und ermöglicht Überprüfungen durch den Verantwortlichen oder einen von ihm beauftragten Prüfer nach rechtzeitiger Ankündigung, zu den üblichen Geschäftszeiten und ohne vermeidbare Störung des Betriebs.",
    ] },
    { h: "13. Schlussbestimmungen", p: [
      "Bei Widersprüchen geht dieser Vertrag den Nutzungsbedingungen vor, soweit es um den Schutz personenbezogener Daten geht. Es gilt das Recht der Bundesrepublik Deutschland. Sollte eine Bestimmung unwirksam sein, bleibt der Vertrag im Übrigen wirksam.",
    ] },
  ],
};
