# Quaderno

Web app installabile (iPad, iPhone, computer) per leggere le proprie dispense.

- Le dispense non sono in questo archivio: l'app le scarica da un archivio GitHub privato con un token salvato solo sul dispositivo, e le tiene offline.
- Nessuna fase di build: index.html, styles.css, app.js (base), personale.js (dati personali sincronizzati su GitHub), note.js (formule, evidenziazioni, note, Chiedi a Claude, PDF), studio.js (mappe e flashcard), sw.js (offline).
- Prova in locale: servi la cartella che contiene quaderno/ e dispense/ e apri http://127.0.0.1:8765/quaderno/?local=1
- Icone: python3 tools/icone.py
