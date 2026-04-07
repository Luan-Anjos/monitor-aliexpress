# monitor-aliexpress v2

Refatoração do monitor de preços do AliExpress com foco em:

- priorizar a **API afiliada oficial** quando você tiver `AE_APP_KEY` e `AE_APP_SECRET`
- usar **browser headless** como fallback quando a API não responder ou o produto não for elegível
- ficar estável em **VM Linux / cloud**, sem depender de interface gráfica
- reduzir falsos positivos escolhendo o preço mais confiável, e não o maior preço da página
- quebrar o relatório do Discord em múltiplas mensagens quando necessário

## Fluxo

1. Lê sua planilha Google Sheets
2. Para cada produto:
   - tenta pegar o preço pela API afiliada do AliExpress
   - se não conseguir, abre a página em browser headless
   - extrai preço primeiro dos módulos estruturados (`runParams` / `__INIT_DATA__`)
   - só depois usa DOM como fallback
3. Compara com o preço da planilha
4. Envia o relatório para o Discord

## Como instalar

```bash
npm install
cp .env.example .env
```

Depois preencha o `.env`.

## Como rodar

```bash
npm start
```

## Variáveis importantes

### Obrigatórias

- `SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT`

### Recomendadas

- `DISCORD_WEBHOOK_URL`
- `TARGET_COUNTRY=BR`
- `TARGET_CURRENCY=BRL`
- `TARGET_LANGUAGE=PT`
- `HEADLESS=true`

### Para usar a API afiliada

- `AE_APP_KEY`
- `AE_APP_SECRET`
- `AE_TRACKING_ID` (opcional, mas recomendado)

## Sobre a VM

Esse projeto já sobe o navegador com:

- `--no-sandbox`
- `--disable-setuid-sandbox`
- `--disable-dev-shm-usage`

Então ele é apropriado para VPS/VM Linux sem X server.

## Estrutura

```text
api/check-prices.js
run.js
src/config.js
src/core/monitor.js
src/services/googleSheets.js
src/services/discord.js
src/services/aliexpressAffiliateApi.js
src/services/aliexpressBrowser.js
src/utils/files.js
src/utils/logger.js
src/utils/prices.js
src/utils/time.js
src/utils/url.js
```

## Observações honestas

- não existe garantia de zero bloqueio no scraping por browser
- quando você tiver acesso à API afiliada, ela deve ser o caminho principal
- alguns produtos podem não aparecer na API afiliada se não forem promovíveis
- scraping do AliExpress muda com frequência; por isso o projeto prioriza dados estruturados e salva artefatos de debug
