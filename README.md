# FantaBid 2.1 — stagione 2026/27

Tutti i file devono essere caricati direttamente nella radice del repository GitHub. Non creare cartelle.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Nella pagina principale del repository devono comparire direttamente `package.json`, `server.js`, `index.html`, `app.js`, `style.css`, `players.json` e gli altri file.

## Novità 2.1
- listone ufficiale Classic 2026/27 con 494 calciatori;
- squadre e badge sociali aggiornati (Frosinone, Monza e Venezia incluse);
- interfaccia responsive per iPhone 12 e successivi e smartphone Android moderni;
- safe area iOS, comandi touch da almeno 44 px e pulsante di rilancio sempre accessibile;
- tutte le funzioni di FantaBid confermate: QR, asta live, TV, statistiche, crediti, rose, backup ed export Excel.

## Aggiornare il listone
Per rigenerare `players.json` da un nuovo file Fantacalcio XLS/XLSX:

```text
npm run import:players -- Quotazioni_Fantacalcio_Stagione_2026_27.xlsx
```

Controlli prima della pubblicazione:

```text
npm run check
npm test
```


## Logo
Questa versione usa il logo FantaBid renderizzato scelto dall'utente in PNG trasparente (`fantabid-logo.png`) e l'icona coordinata (`fantabid-icon.png`).
