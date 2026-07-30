# FantaBid 1.0

Piattaforma web per aste di fantacalcio in presenza o da remoto.

## Funzioni incluse

- accesso dei partecipanti tramite QR code, senza account;
- fino a 100 partecipanti;
- modalità banditore, smartphone e TV/proiettore;
- listone 2025/26 già incluso;
- aggiornamento del listone tramite file `.xls` o `.xlsx`;
- nome, squadra, ruolo e quotazione del calciatore;
- crediti iniziali e limiti di rosa configurabili;
- controllo automatico dei crediti prima di accettare un'offerta;
- spesa massima consigliata calcolata mantenendo la riserva minima per i posti ancora vuoti;
- assegnazione automatica del calciatore alla rosa del vincitore;
- statistiche live, medie per ruolo, top acquisti e classifica spesa;
- esportazione Excel con aggiudicazioni, rose e riepilogo crediti;
- salvataggio automatico ogni 2 minuti e dopo le modifiche principali;
- ripristino della stanza dopo il riavvio del server.

## Pubblicazione su Render

1. Caricare tutti i file nella cartella principale del repository GitHub.
2. Build command: `npm install`
3. Start command: `npm start`
4. Eseguire `Clear build cache & deploy`.

Per un salvataggio realmente persistente su Render, collegare un Persistent Disk e impostare la variabile:

```
DATA_DIR=/var/data/fantabid
```

Senza disco persistente il backup funziona durante il normale utilizzo, ma può andare perso in caso di ricreazione completa dell'istanza o nuovo deploy.

## Aggiornamento listone

Dal pannello banditore premere **Aggiorna da XLS/XLSX** e selezionare il file delle quotazioni. Il sistema riconosce automaticamente il foglio `Tutti` e le colonne Nome, Squadra e Ruolo.

## Calcolo spesa massima

La spesa massima è:

`crediti residui - riserva minima × (posti ancora da coprire - 1)`

In questo modo il partecipante conserva almeno la riserva minima necessaria per completare la rosa.
