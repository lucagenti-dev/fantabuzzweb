# FantaBuzz Web

Web app in tempo reale per aste tra amici, pensata per funzionare da iPhone, Android, tablet e computer.

## Funzioni

- Stanza con codice e QR
- Fino a 80 partecipanti per stanza
- Rilanci +1, +5 e +10
- Countdown riavviato automaticamente a ogni offerta
- Ordine delle offerte gestito dal server
- Pausa, ripresa, assegnazione immediata e reset
- Riconnessione automatica in caso di breve perdita della rete
- Nessun account richiesto

## Avvio sul computer nella stessa rete Wi‑Fi

1. Installa Node.js 18 o successivo.
2. Apri il terminale nella cartella del progetto.
3. Esegui:
   npm install
   npm start
4. Apri sul computer: http://localhost:3000
5. Per far entrare i telefoni, l'indirizzo deve essere quello IP del computer nella rete, ad esempio:
   http://192.168.1.25:3000

Nota: il QR generato da localhost non è raggiungibile dagli altri telefoni. Per l'uso locale apri l'app dal vero indirizzo IP del computer.

## Pubblicazione online consigliata: Render

1. Crea gratuitamente un repository GitHub e carica questi file.
2. Su Render crea un nuovo “Web Service”.
3. Collega il repository.
4. Build command: npm install
5. Start command: npm start
6. Pubblica il servizio.
7. Apri l'indirizzo HTTPS fornito da Render: il QR funzionerà da qualunque telefono.

La stanza vive nella memoria del server. Se il servizio viene riavviato, le stanze aperte vengono azzerate.

## Uso

- Il banditore preme “Crea stanza”.
- Gli altri scansionano il QR, inseriscono il nome ed entrano.
- Il banditore inserisce calciatore/oggetto, base e durata.
- “Prepara”, poi “Avvia countdown”.
- Ogni rilancio riavvia il countdown.
- A zero, l'elemento viene assegnato automaticamente al miglior offerente.

## Nota sul nome

“FantaBuzz Web” è un nome provvisorio. Non è affiliato a FantaBuzzer o Fantacalcio. Per una pubblicazione pubblica è opportuno scegliere un nome e un'identità grafica originali.
