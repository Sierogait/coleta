# VisuWhats Coleta

Página para coleta de provas no celular (Android e iPhone), instalável pela tela inicial.

- **Conversa**: recebe a exportação do WhatsApp, a gravação de tela e prints, calcula o SHA-256 de cada arquivo no próprio aparelho e registra carimbo do tempo (OpenTimestamps), enviando apenas o código.
- **Gravar**: grava áudio (WAV sem filtros) ou vídeo com câmera, com data, hora, local e hash.
- **Biblioteca**: guarda as gravações no aparelho e exporta um pacote .zip.
- **Verificador** (`verificar.html`): confere se um arquivo corresponde ao SHA-256 informado num relatório, com o cálculo feito no navegador.

Nenhum conteúdo é enviado a servidores: tudo é processado no aparelho de quem usa.
