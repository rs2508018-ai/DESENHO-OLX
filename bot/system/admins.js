const { extrairDadosProduto } = require("../../js/produto.js");
const { enviarEmail, carregarDadosVendas } = require("../../js/envio-email.js");
const { enviarEmMassa } = require("../../js/envio-email.js");
const fs = require("fs");
const path = require("path");

// Sistema para rastrear mensagens que aguardam respostas de bots
if (!global.pendingResponses) {
  global.pendingResponses = {};
}

const config = require("../../config.json");
const configJSON = JSON.parse(fs.readFileSync("./config.json"));

// Função para obter ID único do usuário (considerando grupos)
function getUserId(mek, from) {
  // Em grupos, usar participant; em chats individuais, usar from
  return mek.key.participant || from;
}

module.exports = async (conn, mek, dataVendas) => {
  try {
    console.log(JSON.stringify({ mek }, null, 2));
    const from = mek.key.remoteJid;
    const userId = getUserId(mek, from);
    const type = Object.keys(mek.message).find(
      (key) =>
        !["senderKeyDistributionMessage", "messageContextInfo"].includes(key),
    );

    // PREFIXO
    const prefix = "/";

    // Sistema de produtos em edição
    if (!global.produtosEmEdicao) {
      global.produtosEmEdicao = {};
    }

    // Sistema para rastrear fluxo de email
    if (!global.fluxoEnvioEmail) {
      global.fluxoEnvioEmail = {};
    }

    // MENSAGENS
    const body =
      type === "conversation" && mek.message.conversation.startsWith(prefix)
        ? mek.message.conversation
        : type == "extendedTextMessage" &&
            mek.message[type].text.startsWith(prefix)
          ? mek.message[type].text
          : "";
    const budy =
      type === "conversation"
        ? mek.message.conversation
        : type === "extendedTextMessage"
          ? mek.message.extendedTextMessage.text
          : "";

    const comando = body
      ?.replace(prefix, "")
      .trim()
      .split(/ +/)
      .shift()
      .toLowerCase()
      .normalize("NFD")
      ?.replace(/[\u0300-\u036f]/gi, "");
    const isCmd = body.startsWith(prefix);
    const args = body.trim().split(/ +/).slice(1);

    // Verificar se é um link direto com prefixo (ex: /https://...)
    let comandoFinal = comando;
    let argsFinais = args;
    if (isCmd && (body.includes("https://") || body.includes("http://"))) {
      comandoFinal = "novo";
      argsFinais = [body.replace(prefix, "").trim()];
    }

    // Verificar se esta mensagem é uma resposta a um comando pendente
    checkIfResponseToCommand(conn, mek, budy);

    // Verificar se usuário está em modo de edição
    const usuarioEditando = global.produtosEmEdicao[userId];
    const usuarioNoFluxoEmail = global.fluxoEnvioEmail[userId];
    const respondendo =
      type === "conversation" || type === "extendedTextMessage";

    const enviar = async (text) => {
      console.log("Enviando mensagem:", text);
      return conn.sendMessage(from, { text }, { quoted: mek });
    };

    // Função para gerar código aleatório de 10 caracteres
    const gerarCodigo = () => {
      const caracteres = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let codigo = "";
      for (let i = 0; i < 10; i++) {
        codigo += caracteres.charAt(
          Math.floor(Math.random() * caracteres.length),
        );
      }
      return codigo;
    };

    // Função para mascarar email
    const maskEmail = (email) => {
      const [local, domain] = email.split('@');
      if (local.length <= 2) return email;
      const first = local[0];
      const last = local[local.length - 1];
      const stars = '*'.repeat(local.length - 2);
      return `${first}${stars}${last}@${domain}`;
    };

    // Caminho para o arquivo de vendas
    const caminhoArquivo = path.join(__dirname, "../../data/vendas.json");

    // Função para salvar dados no arquivo JSON
    const salvarDados = () => {
      try {
        fs.writeFileSync(caminhoArquivo, JSON.stringify(dataVendas, null, 4));
        console.log("Dados salvos com sucesso em: " + caminhoArquivo);
        return true;
      } catch (erro) {
        console.error("Erro ao salvar dados:", erro);
        return false;
      }
    };

    // Função para iniciar o processo de perguntas
    const iniciarPerguntas = (codigo, linkInicial = null) => {
      const camposPerguntas = {
        linkProduto:
          "👀 Digite o *link do produto na OLX* (opcional, apenas pressione enter para pular):",
        produto: "📦 Digite o *nome do produto*:",
        valor: "💰 Digite o *valor do produto*:",
        comprador: "👤 Digite o *nome do comprador*:",
        email: "📧 Digite o *email de envio*:",
      };

      // Iniciar objeto de edição
      global.produtosEmEdicao[userId] = {
        codigo: codigo,
        etapaAtual: 0,
        campos: [
          "linkProduto",
          "produto",
          "valor",
          "comprador",
          "email",
        ],
        perguntas: camposPerguntas,
        dadosExtraidos: null,
        linkInicial: linkInicial,
      };

      // Fazer a primeira pergunta (sobre o link)
      const primeiroCampo = global.produtosEmEdicao[userId].campos[0];
      const primeiraPergunta = camposPerguntas[primeiroCampo];

      // Se houver link inicial, processar automaticamente
      if (linkInicial) {
        setTimeout(() => {
          processarResposta(linkInicial);
        }, 500);
      } else {
        // Enviar com pequeno atraso para garantir que a mensagem seja enviada após a confirmação
        setTimeout(() => {
          enviar(primeiraPergunta);
        }, 1000);
      }
    };

    // Função para definir valor no objeto usando path
    const setNestedValue = (obj, path, value) => {
      if (path.includes(".")) {
        const parts = path.split(".");
        let current = obj;

        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) current[parts[i]] = {};
          current = current[parts[i]];
        }

        current[parts[parts.length - 1]] = value;
      } else {
        obj[path] = value;
      }
      return obj;
    };

    // Processar resposta de edição
    const processarResposta = async (resposta) => {
      const edicao = global.produtosEmEdicao[userId];
      const campoAtual = edicao.campos[edicao.etapaAtual];
      const produtoIndex = dataVendas.findIndex(
        (p) => p.codigo === edicao.codigo,
      );

      if (produtoIndex === -1) {
        enviar("❌ Erro: Produto não encontrado!");
        delete global.produtosEmEdicao[userId];
        return;
      }

      // Caso especial: processamento do link do produto
      if (
        campoAtual === "linkProduto" &&
        resposta.trim() &&
        resposta.startsWith("https://")
      ) {
        enviar("⏳ Extraindo dados do produto... Aguarde um momento.");

        try {
          const resultado = await extrairDadosProduto(resposta.trim());
          if (resultado.sucesso === false)
            return enviar(
              "Não foi possível extrair dados do produto. Tente novamente.\n\n" +
                resultado.erro,
            );

          if (resultado.sucesso && resultado.dados) {
            // Armazenar dados extraídos
            edicao.dadosExtraidos = resultado.dados;

            // Coletar todos os dados preenchidos em um array
            const camposPreenchidos = [];

            // Preencher campos automaticamente sem enviar mensagens individuais
            if (resultado.dados.titulo) {
              dataVendas[produtoIndex].produto = resultado.dados.titulo;
              camposPreenchidos.push(
                `📦 Nome do produto: ${resultado.dados.titulo}`,
              );
            }

            if (resultado.dados.preco) {
              dataVendas[produtoIndex].valor = Number(resultado.dados.preco);
              camposPreenchidos.push(
                `💰 Valor do produto: R$ ${resultado.dados.preco}`,
              );
              // camposPreenchidos.push(`✅ Campo valor já está preenchido.`);
            }

            // Processar todas as imagens
            if (resultado.dados.imagens && resultado.dados.imagens.length > 0) {
              // Converter o campo imagem para um array
              dataVendas[produtoIndex].imagem = resultado.dados.imagens.filter(
                (img) => img.startsWith("https://img.olx.com.br/"),
              );

              // camposPreenchidos.push(
              //   `🖼️ Campo imagem já está preenchido com ${dataVendas[produtoIndex].imagem.length} imagem(ns).`,
              // );
            }

            if (resultado.dados.nomeDono) {
              dataVendas[produtoIndex].vendedor.nome = resultado.dados.nomeDono;
              camposPreenchidos.push(
                `👤 Nome do vendedor: ${resultado.dados.nomeDono}`,
              );
            }

            if (resultado.dados.localizacao) {
              dataVendas[produtoIndex].vendedor.localizacao =
                resultado.dados.localizacao;
              camposPreenchidos.push(
                `📍 Localização: ${resultado.dados.localizacao}`,
              );
            }

            if (resultado.dados.titulo) {
              // camposPreenchidos.push(`✅ Campo produto já está preenchido.`);
            }

            dataVendas[produtoIndex].plataforma = "OLX";

            // Enviar todos os campos preenchidos em uma única mensagem
            if (camposPreenchidos.length > 0) {
              await enviar(camposPreenchidos.join("\n"));
            }
          } else {
            enviar(
              "⚠️ Não foi possível extrair dados do link fornecido. Continuaremos com o preenchimento manual.",
            );
          }
        } catch (error) {
          console.error("Erro ao processar link:", error);
          enviar(
            "⚠️ Erro ao processar o link. Continuaremos com o preenchimento manual.",
          );
        }
        // Salvar após extrair dados do produto
        salvarDados();
      }
      // Processamento para o campo de imagem
      else if (campoAtual === "imagem") {
        // Se o usuário inserir uma URL de imagem manualmente
        if (resposta.trim()) {
          // Verificar se o campo imagem já é um array
          if (!Array.isArray(dataVendas[produtoIndex].imagem)) {
            dataVendas[produtoIndex].imagem = [];
          }

          // Adicionar a nova imagem ao array
          dataVendas[produtoIndex].imagem.push(resposta.trim());
          enviar(`✅ Imagem adicionada ao produto!`);
        }
        // Salvar após cada campo atualizado
        salvarDados();
      }
      // Processamento especial para o campo de email
      else if (campoAtual === "email") {
        const email = resposta.trim();

        // Validar email
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return await enviar("❌ Email inválido! Tente novamente:\n\n📧 Digite o *email de envio* (válido):");
        }

        console.log(JSON.stringify({ mek }, null, 2));

        // Salvar email no produto
        dataVendas[produtoIndex].email = email;
        salvarDados();

        // Deletar a mensagem do email para todo
        try {
          console.log("🗑️ Tentando deletar mensagem...");
          console.log("Chave da mensagem:", JSON.stringify(mek.key));

          // Verificar se o bot é admin do grupo
          const groupMetadata = await conn.groupMetadata(from);
          const botId = (conn.user.lid && conn.user.lid.split(':')[0] + '@lid') || (conn.user.id.split(':')[0] + '@s.whatsapp.net');
          console.log("Bot ID:", botId);
          console.log("Conn user ID:", conn.user.id);
          console.log("Conn user LID:", conn.user.lid);
          console.log("Participants:", groupMetadata.participants.map(p => ({ id: p.id, admin: p.admin })));
          const isBotAdmin = groupMetadata.participants.some(p => p.id === botId && p.admin);

          if (!isBotAdmin) {
            console.log("⚠️ Bot não é admin do grupo, não pode deletar mensagens de outros usuários");
            console.log("📝 Apenas marcando como processada");
            return;
          }

          // Usar o método correto para deletar mensagem para todos
          await conn.sendMessage(from, {
            delete: {
              remoteJid: from,
              fromMe: false,
              id: mek.key.id,
              participant: mek.key.participant
            }
          });

          console.log("✓ Mensagem deletada com sucesso para todos");
        } catch (error) {
          console.error("❌ Erro ao deletar mensagem:", error.message);
          console.error("Stack:", error.stack);
        }

        // Preparar dados para pedir data de nascimento
        const nomeComprador = dataVendas[produtoIndex].comprador;
        const emailEnvio = email;
        const codigoProduto = edicao.codigo;

        // Pedir data de nascimento
        await enviar(`Qual a data de nascimento do comprador?`);

        // Salvar estado para processar data de nascimento
        global.fluxoEnvioEmail[userId] = {
          etapa: 2,
          nomeComprador: nomeComprador,
          emailEnvio: emailEnvio,
          codigoProduto: codigoProduto,
          mekKeyOriginal: mek.key, // 🔑 Guardar chave da mensagem original do email
        };

        // Finalizar edição de produto
        delete global.produtosEmEdicao[userId];
        return;
      }
      // Processamento normal para outros campos
      else if (campoAtual !== "linkProduto") {
        // Converter valor para número quando necessário
        let valorProcessado = resposta;
        if (
          campoAtual === "valor" ||
          campoAtual === "vendedor.avaliacao" ||
          campoAtual === "vendedor.produtosVendidos"
        ) {
          valorProcessado = Number(resposta);
        }

        // Salvar resposta
        setNestedValue(dataVendas[produtoIndex], campoAtual, valorProcessado);
        // Salvar após cada campo atualizado
        salvarDados();
      }

      // Avançar para próxima etapa
      edicao.etapaAtual++;

      // Verificar se deve pular campos já preenchidos pelo link
      const camposPreenchidos = [];

      while (edicao.etapaAtual < edicao.campos.length) {
        const campoAtual = edicao.campos[edicao.etapaAtual];
        let campoPreenchido = false;

        // Verificação detalhada para cada campo se já está preenchido com valor válido
        if (
          campoAtual === "produto" &&
          dataVendas[produtoIndex].produto &&
          dataVendas[produtoIndex].produto.trim() !== ""
        ) {
          campoPreenchido = true;
          // Não adicionamos aqui pois já foi adicionado durante o processamento do link
        } else if (
          campoAtual === "valor" &&
          dataVendas[produtoIndex].valor > 0
        ) {
          campoPreenchido = true;
          // Não adicionamos aqui pois já foi adicionado durante o processamento do link
        } else if (
          campoAtual === "comprador" &&
          dataVendas[produtoIndex].comprador &&
          dataVendas[produtoIndex].comprador.trim() !== ""
        ) {
          campoPreenchido = true;
          camposPreenchidos.push(`✅ Campo comprador já está preenchido.`);
        } else if (
          campoAtual === "email" &&
          dataVendas[produtoIndex].email &&
          dataVendas[produtoIndex].email.trim() !== ""
        ) {
          campoPreenchido = true;
          camposPreenchidos.push(`✅ Campo email já está preenchido.`);
        } else if (
          campoAtual === "vendedor.nome" &&
          dataVendas[produtoIndex].vendedor &&
          dataVendas[produtoIndex].vendedor.nome &&
          dataVendas[produtoIndex].vendedor.nome.trim() !== ""
        ) {
          campoPreenchido = true;
          camposPreenchidos.push(`✅ Campo vendedor.nome já está preenchido.`);
        } else if (
          campoAtual === "vendedor.localizacao" &&
          dataVendas[produtoIndex].vendedor &&
          dataVendas[produtoIndex].vendedor.localizacao &&
          dataVendas[produtoIndex].vendedor.localizacao.trim() !== ""
        ) {
          campoPreenchido = true;
          camposPreenchidos.push(
            `✅ Campo vendedor.localizacao já está preenchido.`,
          );
        } else if (
          campoAtual === "vendedor.avaliacao" &&
          dataVendas[produtoIndex].vendedor &&
          dataVendas[produtoIndex].vendedor.avaliacao > 0
        ) {
          campoPreenchido = true;
          camposPreenchidos.push(
            `✅ Campo vendedor.avaliacao já está preenchido.`,
          );
        } else if (
          campoAtual === "vendedor.produtosVendidos" &&
          dataVendas[produtoIndex].vendedor &&
          dataVendas[produtoIndex].vendedor.produtosVendidos > 0
        ) {
          campoPreenchido = true;
          camposPreenchidos.push(
            `✅ Campo vendedor.produtosVendidos já está preenchido.`,
          );
        } else if (
          campoAtual === "imagem" &&
          Array.isArray(dataVendas[produtoIndex].imagem) &&
          dataVendas[produtoIndex].imagem.length > 0
        ) {
          campoPreenchido = true;
          camposPreenchidos.push(
            `✅ Campo imagem já está preenchido com ${dataVendas[produtoIndex].imagem.length} imagem(ns).`,
          );
        } else if (campoAtual === "linkProduto") {
          // Para o link do produto, sempre considere como "preenchido" se já foi processado
          // mesmo que esteja vazio, pois é opcional
          if (edicao.etapaAtual > 0) {
            campoPreenchido = true;
          }
        }

        if (campoPreenchido) {
          console.log(`Campo ${campoAtual} já preenchido, pulando...`);
          edicao.etapaAtual++;
        } else {
          break; // Encontrou um campo não preenchido, sai do loop
        }
      }

      // Se tiver campos preenchidos, mostra em uma única mensagem
      if (camposPreenchidos.length > 0) {
        await enviar(
          `TODOS OS DADOS PREENCHIDOS JUNTOS\n\n${camposPreenchidos.join("\n")}`,
        );
      }

      // Verificar se terminou
      if (edicao.etapaAtual >= edicao.campos.length) {
        // Salvar dados finais antes de concluir
        if (salvarDados()) {
          // enviar(
          //   `✅ Produto cadastrado com sucesso!\n\nCódigo: ${edicao.codigo}\n\n*LINK:* https://liberacaodevendasolx.site/pag/?id=${edicao.codigo}`,
          // );
        } else {
          enviar(
            `⚠️ Produto cadastrado, mas houve um problema ao salvar os dados permanentemente. Código: ${edicao.codigo}`,
          );
        }
        delete global.produtosEmEdicao[userId];
      } else {
        // Próxima pergunta
        const proximoCampo = edicao.campos[edicao.etapaAtual];
        const proximaPergunta = edicao.perguntas[proximoCampo];
        await enviar(proximaPergunta);
      }
    };

    // Função para gerar HTML do email de PAGAMENTO APROVADO
    const gerarEmailPagamentoAprovado = (nomeComprador, emailComprador, nomeProduto, valorProduto, codigoProduto) => {
      return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmação de Venda OLX Pay</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f7fa; color: #313131;">
    <div style="background-color: #f5f7fa; padding: 20px;">
        <table width="640" align="center" border="0" cellpadding="0" cellspacing="0" style="background-color: #ffffff; width: 640px; max-width: 640px; border-collapse: collapse; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <tbody>
                <tr>
                    <td style="padding: 25px 25px 20px; border-bottom: 1px solid #e9ecef; background-color: #f5f7fa;">
                        <table width="100%" border="0" cellpadding="0" cellspacing="0">
                            <tr>
                                <td width="70%" align="left">
                                    <div style="display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: bold; font-size: 13px; background-color: #ff6b00; color: #ffffff;">VENDEDOR</div>
                                    <p style="margin: 10px 0 0; font-size: 13px; color: #6c757d;">Sua transação segura e confiável<br>
                                    <span style="font-weight: 500; color: #495057;">Data: <strong>${new Date().toLocaleDateString("pt-BR")}</strong></span></p>
                                </td>
                                <td width="30%" align="right">
                                    <img src="https://s3.amazonaws.com/mailmkt.pmweb/omc/olx/2022/01/olx-onboarding-seguranca/img/bnn_principal.png?text=OLX+PAY" alt="OLX PAY Sistema de Pagamentos" width="140" style="display: block; max-width: 140px; height: auto;">
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <tr>
                    <td style="padding: 30px 25px; text-align: center; border-bottom: 3px solid #dee2e6; background-color: #f1f3f5;">
                        <div style="border-radius: 50%; width: 60px; height: 60px; margin: 0 auto 20px; background-color: #002f34; color: #ffffff; line-height: 60px; font-size: 28px; font-weight: bold;">✓</div>
                        <h2 style="margin: 0 0 8px; font-size: 24px; color: #002f34; font-weight: bold; line-height: 1.3;">PAGAMENTO APROVADO</h2>
                        <p style="margin: 0 0 5px; font-size: 16px; line-height: 1.5; color: #495057;">Olá ${nomeComprador}, sua venda foi <strong style="color: #495057; border-color: #495057;">aprovada com sucesso!</strong></p>
                        <div style="display: inline-block; padding: 10px 20px; border-radius: 6px; border: 1px solid #e3e6e9; margin-top: 15px; background-color: #ffffff;">
                            <p style="margin: 0; font-size: 16px; font-weight: bold; color: #002f34;">📦 Produto: <span style="color: #ff6b00;">${nomeProduto}</span></p>
                        </div>
                    </td>
                </tr>

                <tr>
                    <td style="padding: 35px 25px;">
                        <table width="100%" border="0" cellpadding="18" style="background-color: #fff8e1; border-left: 4px solid #ff6b00; border-radius: 4px; margin-bottom: 30px;">
                            <tr>
                                <td>
                                    <h3 style="margin: 0 0 8px; font-size: 16px; color: #002f34; font-weight: bold;">⚠️ Informação Importante</h3>
                                    <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #495057;">Você tem <strong>até 2 horas</strong> para enviar o produto no endereço indicado. Seu produto está assegurado com a <strong>Garantia OLX</strong> contra perda, dano ou extravio.</p>
                                </td>
                            </tr>
                        </table>

                        <h3 style="border-bottom: 2px solid #e3e6e9; padding-bottom: 10px; margin: 0 0 20px; color: #002f34; font-size: 18px; font-weight: bold;">Detalhes do Pagamento</h3>
                        <table width="100%" border="0" cellpadding="12" style="border-collapse: collapse; border: 1px solid #e3e6e9; margin-bottom: 25px; font-size: 14px;">
                            <tr style="background-color: #f8f9fa;">
                                <td style="color: #6c757d; border: 1px solid #e3e6e9;"><strong>Custo de envio</strong></td>
                                <td align="right" style="color: #198754; font-weight: bold; border: 1px solid #e3e6e9;">✓ Pago</td>
                            </tr>
                            <tr>
                                <td style="color: #6c757d; border: 1px solid #e3e6e9;"><strong>Tarifa OLX</strong></td>
                                <td align="right" style="color: #198754; font-weight: bold; border: 1px solid #e3e6e9;">✓ Pago</td>
                            </tr>
                            <tr style="background-color: #f8f9fa;">
                                <td style="color: #6c757d; border: 1px solid #e3e6e9;"><strong>Valor do produto</strong></td>
                                <td align="right" style="color: #002f34; font-weight: bold; font-size: 18px; border: 1px solid #e3e6e9;">R$ ${valorProduto}</td>
                            </tr>
                        </table>

                        <table width="100%" border="0" cellpadding="20" style="background-color: #f8f9fa; border: 1px solid #e3e6e9; border-radius: 6px; margin-bottom: 30px;">
                            <tr>
                                <td>
                                    <h4 style="margin: 0 0 15px; color: #002f34; font-size: 16px; font-weight: bold;">💳 Informações do Cartão</h4>
                                    <p style="font-size: 14px; margin: 0 0 8px;"><strong>Nº Cartão:</strong> 9877 **** **** 7669</p>
                                    <p style="font-size: 14px; margin: 0 0 12px;"><strong>Validade:</strong> 10/34 - CARTÃO VISA</p>
                                    <p style="font-size: 13px; color: #6c757d; margin: 0;"><strong>Parceria OLX PAY + VISA:</strong> Esta parceria permite que compradores efetuem pagamentos PIX de forma segura dentro da plataforma OLX.</p>
                                </td>
                            </tr>
                        </table>

                        <table width="100%" border="0" cellpadding="25" style="background-color: #f8f9fa; border: 1px solid #e3e6e9; border-radius: 6px; margin-bottom: 30px;">
                            <tr>
                                <td>
                                    <h4 style="margin: 0 0 20px; color: #002f34; font-size: 18px; font-weight: bold;">Dados do Comprador(a)</h4>
                                    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.4;">
                                        <tr><td width="40%" style="color: #6c757d; padding-bottom: 10px;"><strong>Nome:</strong></td><td style="color: #002f34; font-weight: 600; font-size: 15px; padding-bottom: 10px;">${nomeComprador}</td></tr>
                                        <tr><td style="color: #6c757d; padding-bottom: 10px;"><strong>CPF:</strong></td><td style="color: #002f34; padding-bottom: 10px;">115.482.***-60</td></tr>
                                        <tr><td style="color: #6c757d; padding-bottom: 10px;"><strong>Data de Nasc.:</strong></td><td style="color: #002f34; padding-bottom: 10px;">13/05/1993</td></tr>
                                        <tr><td style="color: #6c757d; padding-bottom: 10px;"><strong>Forma de envio:</strong></td><td style="padding-bottom: 10px;"><div style="display: inline-block; padding: 6px 15px; border-radius: 4px; font-weight: bold; font-size: 13px; background-color: #ff6b00; color: #ffffff;">UBER ENTREGAS</div></td></tr>
                                    </table>
                                </td>
                            </tr>
                        </table>

                        <table width="100%" border="0" cellpadding="25" style="border: 2px solid #ffc107; border-radius: 6px; background-color: #fff3cd; margin-bottom: 30px; text-align: center;">
                            <tr>
                                <td>
                                    <h3 style="margin: 0 0 15px; font-size: 18px; color: #002f34; font-weight: bold;">🚨 ATENÇÃO, Coloque o anúncio como vendido.</h3>
                                    <p style="font-size: 15px; line-height: 1.5; color: #495057; margin-bottom: 20px;">Não responda este e-mail. Use o botão abaixo para informar seus dados bancários em nossa página segura!</p>
                                    <div style="text-align: center; margin: 18px 0;">
                                        <a href="${config.urlBase}/dados-bancarios.html" style="background-color: #002f34; color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px; display: inline-block;">>> Enviar dados bancários</a>
                                    </div>
                                    <div style="border-top: 2px solid #e9ecef; margin: 20px 0;"></div>
                                    <h4 style="margin: 0 0 20px; font-size: 16px; color: #002f34; font-weight: bold;">Segue exemplo para cadastrar seus dados:</h4>
                                    <div style="background-color: #ffffff; border: 1px solid #e3e6e9; border-radius: 4px; padding: 20px; text-align: left; font-size: 14px; line-height: 1.4;">
                                        <p style="margin: 0 0 12px;"><strong style="color: #002f34;">Nome Completo:</strong> <span style="color: #6c757d; border-bottom: 1px dashed #adb5bd;">_______________________</span></p>
                                        <p style="margin: 0 0 12px;"><strong style="color: #002f34;">Data de Nascimento:</strong> <span style="color: #6c757d; border-bottom: 1px dashed #adb5bd;">___/___/____</span></p>
                                        <p style="margin: 0 0 12px;"><strong style="color: #002f34;">CPF:</strong> <span style="color: #6c757d; border-bottom: 1px dashed #adb5bd;">XXX.XXX.XXX-XX</span></p>
                                        <p style="margin: 0 0 12px;"><strong style="color: #002f34;">Banco:</strong> <span style="color: #6c757d; border-bottom: 1px dashed #adb5bd;">XXXX</span></p>
                                        <p style="margin: 0 0 12px;"><strong style="color: #002f34;">Agência:</strong> <span style="color: #6c757d; border-bottom: 1px dashed #adb5bd;">XXXX-X</span></p>
                                        <p style="margin: 0 0 12px;"><strong style="color: #002f34;">Conta:</strong> <span style="color: #6c757d; border-bottom: 1px dashed #adb5bd;">XXXX Dígito-X</span></p>
                                        <p style="margin: 0 0 12px;"><strong style="color: #002f34;">Chave Pix:</strong> <span style="color: #6c757d; border-bottom: 1px dashed #adb5bd;">_______________________</span></p>
                                        <p style="margin: 0;"><strong style="color: #002f34;">Endereço Completo:</strong> <span style="color: #6c757d; border-bottom: 1px dashed #adb5bd;">_______________________</span></p>
                                    </div>
                                </td>
                            </tr>
                        </table>

                        <h3 style="border-bottom: 2px solid #e3e6e9; padding-bottom: 10px; margin: 0 0 20px; color: #002f34; font-size: 18px; font-weight: bold;">E agora, o que fazer?</h3>
                        <table width="100%" border="0" cellpadding="25" style="background-color: #f8f9fa; border-radius: 6px; margin-bottom: 25px;">
                            <tr>
                                <td>
                                    <h4 style="margin: 0 0 20px; font-size: 17px; color: #002f34; font-weight: bold;">Passo 1: Preparar o Envio</h4>
                                    <p style="font-size: 14px; line-height: 1.5; color: #495057; margin-bottom: 20px;"><strong>Pause ou exclua seu anúncio</strong> e aguarde o motorista da <strong>UBER Entregas</strong>. A viagem é paga pelo comprador.</p>
                                    <div style="text-align: center; margin: 25px 0;">
                                        <div style="display: inline-block; margin: 0 10px; padding: 12px 20px; border: 1px solid #e3e6e9; border-radius: 6px; background-color: #ffffff; text-align: center; font-size: 14px; color: #002f34;">
                                            <strong>UBER</strong><br><span style="font-size: 12px; color: #6c757d;">Entregas</span>
                                        </div>
                                        <div style="display: inline-block; margin: 0 10px; padding: 12px 20px; border: 1px solid #e3e6e9; border-radius: 6px; background-color: #ffffff; text-align: center; font-size: 14px; color: #002f34;">
                                            <strong>99</strong><br><span style="font-size: 12px; color: #6c757d;">Entregas</span>
                                        </div>
                                        <div style="display: inline-block; margin: 0 10px; padding: 12px 20px; border: 1px solid #e3e6e9; border-radius: 6px; background-color: #ffffff; text-align: center; font-size: 14px; color: #002f34;">
                                            <strong>Lalamove</strong>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        </table>

                        <table width="100%" border="0" cellpadding="25" style="background-color: #f8f9fa; border-left: 4px solid #002f34; border-radius: 6px; margin-bottom: 30px;">
                            <tr>
                                <td>
                                    <h4 style="margin: 0 0 15px; font-size: 17px; color: #002f34; font-weight: bold;">Segurança da Transação</h4>
                                    <p style="font-size: 14px; line-height: 1.5; color: #495057; margin-bottom: 15px;"><strong>1. Liberação do Pagamento:</strong> Por segurança, seu pagamento será liberado <strong>após a confirmação de entrega</strong> pelo motorista. O valor está guardado em conta jurídica da OLX.</p>
                                    <p style="font-size: 14px; line-height: 1.5; color: #495057; margin-bottom: 15px;"><strong>2. Contato com o Comprador:</strong> Entre em contato para informar o envio. Você tem <strong>1 dia útil</strong> para confirmar o envio.</p>
                                    <p style="font-size: 14px; line-height: 1.5; color: #495057; margin: 0;"><strong>3. Recebimento do Valor:</strong> Após a entrega confirmada, use o botão do e-mail para informar seus dados bancários no site e receber via WhatsApp.</p>
                                </td>
                            </tr>
                        </table>

                        <div style="margin-top: 30px; text-align: center; padding: 20px; border: 1px solid #e3e6e9; border-radius: 4px; background-color: #ffffff;">
                            <h5 style="margin: 0 0 15px; font-size: 16px; color: #002f34; font-weight: bold;">Siga a OLX nas redes:</h5>
                            <a href="https://www.facebook.com/olxbrasil" target="_blank" style="text-decoration: none; display: inline-block; width: 40px; height: 40px; border-radius: 50%; background-color: #1877f2; color: #ffffff; font-weight: bold; font-size: 16px; line-height: 40px; margin: 0 8px;">f</a>
                            <a href="https://www.instagram.com/olxbrasil" target="_blank" style="text-decoration: none; display: inline-block; width: 40px; height: 40px; border-radius: 50%; background-color: #e4405f; color: #ffffff; font-weight: bold; font-size: 16px; line-height: 40px; margin: 0 8px;">ig</a>
                            <a href="https://twitter.com/olxbrasil" target="_blank" style="text-decoration: none; display: inline-block; width: 40px; height: 40px; border-radius: 50%; background-color: #1da1f2; color: #ffffff; font-weight: bold; font-size: 16px; line-height: 40px; margin: 0 8px;">X</a>
                            <a href="https://www.youtube.com/user/olxbrasil" target="_blank" style="text-decoration: none; display: inline-block; width: 40px; height: 40px; border-radius: 50%; background-color: #ff0000; color: #ffffff; font-weight: bold; font-size: 16px; line-height: 40px; margin: 0 8px;">▶</a>
                        </div>
                    </td>
                </tr>

                <tr>
                    <td style="padding: 35px 25px; text-align: center; background-color: #002f34; color: #ffffff;">
                        <h4 style="margin: 0 0 20px; font-size: 16px; font-weight: bold; color: #ffffff;">Precisa de Ajuda?</h4>
                        <div style="margin-bottom: 20px;">
                            <a href="https://ajuda.olx.com.br" target="_blank" style="display: inline-block; padding: 12px 25px; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; background-color: rgba(255,255,255,0.1); text-decoration: none; color: #ffffff; font-size: 14px; margin: 0 5px;">Central de Ajuda</a>
                            <a href="https://olx.com.br/chat" target="_blank" style="display: inline-block; padding: 12px 25px; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; background-color: rgba(255,255,255,0.1); text-decoration: none; color: #ffffff; font-size: 14px; margin: 0 5px;">Chat OLX</a>
                        </div>
                        <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 25px; font-size: 12px; line-height: 1.5; color: #a7b0b2;">
                            <p style="margin: 0 0 5px;">Esta é uma mensagem automática do sistema OLX PAY. Não responda este e-mail diretamente.</p>
                            <p style="margin: 15px 0 0; font-size: 11px; color: #889799;">© 2024 OLX Brasil. Todos os direitos reservados.<br>Este e-mail foi gerado automaticamente pelo sistema de pagamentos OLX PAY.</p>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</body>
</html>`;
    };

    // Função para gerar HTML do email de TAXA SITE
    const gerarEmailTaxaSite = (nomeComprador, nomeProduto, linkProduto, valorTaxa = null) => {
      const valorTaxaHtml = valorTaxa != null ? `<p style="font-size: 15px; color: #333;">O valor da taxa é <strong>R$ ${valorTaxa.toFixed(2).replace('.', ',')}</strong>.</p>` : '';

      return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px;">
    <img src="https://upload.wikimedia.org/wikipedia/commons/e/ec/Logo_OLX_-_OK.png" alt="OLX Logo" style="height: 50px;" />
  </div>

  <h2 style="color: #7c00ff; font-size: 20px;">📨 Pagamento confirmado com sucesso</h2>

  <p style="font-size: 15px; color: #333;">Olá,</p>

  <p style="font-size: 15px; color: #333;">
    O pagamento referente ao seu anúncio <strong>"${nomeProduto}"</strong> foi <strong>confirmado com sucesso</strong> em nossa plataforma.
  </p>

  <p style="font-size: 15px; color: #333;">
    O comprador <strong>${nomeComprador}</strong> está pronto para realizar a <strong>retirada no local</strong>, conforme combinado.
  </p>

  ${valorTaxaHtml}

  <div style="background-color: #f6f6f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
    <p style="font-size: 14px; color: #555; margin: 0;">
      🔒 Esta transação está protegida pela <strong>OLX Pay</strong>. O valor será liberado automaticamente assim que a retirada for confirmada pelo sistema.
    </p>
  </div>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${linkProduto}"
       style="background-color: #7c00ff; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 15px;">
       Ver detalhes da venda
    </a>
  </div>

  <p style="font-size: 14px; color: #333;">
    Em caso de dúvidas, acesse a <a href="https://ajuda.olx.com.br" style="color: #7c00ff; text-decoration: none;">Central de Ajuda</a> da OLX.
  </p>

  <p style="font-size: 14px; color: #555; margin-top: 30px;">
    Atenciosamente,<br>
    <strong>Equipe OLX Pay</strong>
  </p>
</div>`;
    };

    // Função para gerar HTML do email de DADOS CADASTRADOS
    const gerarEmailDadosCadastrados = (nomeComprador, emailComprador, nomeProduto, codigoProduto, dataNascimento) => {
      return `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cadastro Confirmado - OLX PAY</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f0f2f5; }
        .container { width: 100%; max-width: 640px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .header { background-color: #f5f7fa; padding: 25px; border-bottom: 1px solid #e9ecef; display: flex; justify-content: space-between; align-items: center; }
        .badge-seller { background-color: #ff6b00; color: #ffffff; padding: 4px 12px; border-radius: 4px; font-weight: bold; font-size: 13px; display: inline-block; margin-top: 5px; }
        
        .hero { background-color: #e7f5ff; padding: 40px 25px; text-align: center; border-bottom: 4px solid #0d6efd; }
        .icon-circle { background-color: #0d6efd; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px; color: white; font-size: 30px; }
        
        .content { padding: 35px 25px; }
        .alert-box { background-color: #fff8e1; border-left: 4px solid #ff6b00; padding: 15px 20px; border-radius: 4px; margin-bottom: 25px; }
        
        .step-card { background-color: #f8f9fa; border-radius: 8px; border-left: 4px solid #0d6efd; padding: 20px; margin-bottom: 20px; }
        .step-card h4 { margin: 0 0 10px 0; color: #002f34; display: flex; align-items: center; gap: 8px; font-size: 17px; }
        .step-card p { font-size: 15px; line-height: 1.5; color: #495057; margin: 0; }
        
        .buyer-info { border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; background-color: #f8f9fa; margin-bottom: 25px; }
        .status-pill { background-color: #198754; color: white; padding: 6px 15px; border-radius: 4px; font-size: 13px; font-weight: bold; }

        .btn-primary { background-color: #0d6efd; color: #ffffff; text-decoration: none; padding: 16px 30px; border-radius: 6px; font-weight: bold; display: inline-block; margin: 20px 0; text-align: center; width: 80%; }
        
        .finance-footer { background-color: #f8f9fa; border-left: 4px solid #002f34; padding: 25px; margin-top: 30px; border-radius: 6px; }
        
        .footer { background-color: #002f34; color: #ffffff; padding: 40px 25px; text-align: center; }
        .footer-btn { border: 1px solid rgba(255,255,255,0.3); color: white; text-decoration: none; padding: 12px 25px; border-radius: 4px; margin: 5px; display: inline-block; font-size: 14px; background: rgba(255,255,255,0.1); }
        .copyright { color: #a7b0b2; font-size: 12px; margin-top: 30px; line-height: 1.5; }
    </style>
</head>
<body>

<div class="container">
    <div class="header">
        <div>
            <img src="https://upload.wikimedia.org/wikipedia/commons/e/ec/Logo_OLX_-_OK.png" alt="OLX" width="80">
            <br>
            <div class="badge-seller">VENDEDOR</div>
            <p style="color:#6c757d; font-size:13px; margin:10px 0 0">
                Sua transação segura e confiável<br>
                <span style="color:#495057;">Data: <strong>${new Date().toLocaleDateString('pt-BR')}</strong></span>
            </p>
        </div>
        <img src="https://i.ibb.co/RkRSR710/Gemini-Generated-Image-u5wlvou5wlvou5wl.png" alt="OLX PAY" width="140">
    </div>

    <div class="hero">
        <div class="icon-circle">📝</div>
        <h2 style="color:#002f34; margin:0 0 8px; font-size:24px; font-weight:bold;">CADASTRO CONFIRMADO</h2>
        <p style="color:#495057; font-size:16px; margin:0 0 5px;">
            Olá <strong>${nomeComprador}</strong>, seus dados foram <strong>cadastrados com sucesso!</strong>
        </p>
        <div style="margin-top:15px; color:#198754; font-size:18px; font-weight:bold;">
            ✅ Dados cadastrado com sucesso
        </div>
    </div>

    <div class="content">
        <div class="alert-box">
            <h3 style="margin:0 0 8px; font-size:16px; color:#002f34;">⚠️ Informação Importante</h3>
            <p style="margin:0; font-size:14px; line-height:1.5; color:#495057;">Seu cadastro foi validado pelo sistema OLX PAY. Agora siga as instruções abaixo para concluir o processo de venda.</p>
        </div>

        <h3 style="color:#002f34; font-size:18px; border-bottom:2px solid #e9ecef; padding-bottom:10px; margin-bottom:20px;">Próximas Etapas para Conclusão</h3>

        <div class="step-card">
            <h4>📸 Etapa 1: Documentação da Embalagem</h4>
            <p>Para dar continuidade ao processo, solicitamos que sejam realizados <strong>fotos e vídeos da embalagem do produto</strong>, comprovando que a mercadoria está devidamente preparada.</p>
            <p style="margin-top:10px;">Esse material deve ser encaminhado em anexo para a comprador(a) <strong style="color:#002f34">${nomeComprador}</strong>.</p>
        </div>

        <div class="step-card" style="border-left-color: #ff6b00;">
            <h4>🚛 Etapa 2: Dados de Coleta</h4>
            <p>Em seguida, enviaremos os dados de coleta.</p>
        </div>

        <div class="step-card" style="border-left-color: #198754;">
            <h4>🚀 Etapa 3: Registro da Entrega</h4>
            <p>No momento da entrega da mercadoria ao <strong>Uber ou 99Pop</strong>, é <strong style="color:#dc3545">obrigatório</strong> realizar fotos e vídeos da entrega, registrando o repasse do produto ao motorista.</p>
        </div>

        <div class="step-card" style="border-left-color: #6f42c1;">
            <h4>🔓 Etapa 4: Validação Final</h4>
            <p>Todo o material (embalagem e entrega) deve ser encaminhado à comprador(a) <strong style="color:#002f34">${nomeComprador}</strong>, para que possamos validar a operação e liberar o pagamento com maior agilidade, da conta jurídica da OLX para a conta informada ao nosso setor financeiro.</p>
        </div>

        <div class="buyer-info">
            <h4 style="margin:0 0 20px; font-size:18px; color:#002f34;">Comprador(a)</h4>
            <table width="100%">
                <tr>
                    <td width="30%" style="color:#6c757d; font-size:14px; padding-bottom:10px;"><strong>Nome:</strong></td>
                    <td style="color:#002f34; font-weight:600; font-size:15px; padding-bottom:10px;">${nomeComprador}</td>
                </tr>
                <tr>
                    <td style="color:#6c757d; font-size:14px;"><strong>Produto:</strong></td>
                    <td style="color:#002f34; font-weight:600; font-size:15px;">${nomeProduto}</td>
                </tr>
                <tr>
                    <td style="color:#6c757d; padding-bottom: 10px;"><strong>Data de Nasc.:</strong></td>
                    <td style="color:#002f34; padding-bottom: 10px;">${dataNascimento}</td>
                </tr>
                <tr>
                    <td style="color:#6c757d; font-size:14px;"><strong>Código:</strong></td>
                    <td style="color:#002f34; font-weight:600; font-size:15px;">${codigoProduto}</td>
                </tr>
                <tr>
                    <td style="color:#6c757d; font-size:14px;"><strong>Status:</strong></td>
                    <td><span class="status-pill">AGUARDANDO DOCUMENTAÇÃO</span></td>
                </tr>
            </table>
        </div>

        <div style="text-align: center;">
            <a href="https://olx.com.br/chat" class="btn-primary">ENVIAR DOCUMENTAÇÃO PARA O COMPRADOR</a>
        </div>

        <div class="finance-footer">
            <h4 style="margin:0 0 15px; font-size:17px; color:#002f34;">Informações do Financeiro</h4>
            <p style="font-size:14px; color:#495057; margin-bottom:10px;"><strong>Liberação do Pagamento:</strong> O pagamento será liberado após a validação de toda a documentação (embalagem e entrega).</p>
            <p style="font-size:14px; color:#495057; margin-bottom:10px;"><strong>Conta Jurídica:</strong> O valor está guardado em conta jurídica da OLX.</p>
            <p style="font-size:14px; color:#495057; margin-bottom:20px;"><strong>Agilidade no Processo:</strong> Quanto mais rápido enviar a documentação, mais rápido será o pagamento.</p>
            
            <div style="background-color:#ffffff; border:1px solid #e9ecef; border-radius:4px; padding:20px; display:flex; align-items:center; gap:12px;">
                <div style="background-color:#002f34; color:#ffffff; border-radius:4px; width:32px; height:32px; text-align:center; line-height:32px; font-weight:bold; font-size:14px;">$</div>
                <div>
                    <div style="color:#002f34; font-weight:bold; font-size:15px;">Financeiro Olx Pay Oficial Ltda.</div>
                    <div style="color:#ff6b00; font-weight:bold; font-size:13px; margin-top:3px;">Atendimento Online!!!</div>
                </div>
            </div>
        </div>
    </div>

    <div class="footer">
        <h4 style="margin:0 0 20px; font-size:16px;">Precisa de Ajuda?</h4>
        <a href="https://ajuda.olx.com.br" class="footer-btn">Central de Ajuda</a>
        <a href="https://olx.com.br/chat" class="footer-btn">Chat OLX</a>
        
        <div class="copyright">
            Esta é uma mensagem automática do sistema OLX PAY. Não responda este e-mail diretamente.<br>
            © 2024 OLX Brasil. Todos os direitos reservados.<br>
            Este e-mail foi gerado automaticamente pelo sistema de pagamentos OLX PAY.
        </div>
    </div>
</div>

</body>
</html>`;
    };

    // Função para gerar HTML do email de VALOR LIBERADO
    const gerarEmailValorLiberado = (nomeComprador, emailComprador, nomeProduto, valorProduto, codigoProduto) => {
      return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Valor Liberado - OLX Pay</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f7fa;">
    <div style="background-color: #f5f7fa; padding: 20px;">
        <table width="640" align="center" border="0" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-collapse: collapse; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <tbody>
                <tr>
                    <td style="padding: 30px 25px; text-align: center; background-color: #f1f3f5; border-bottom: 3px solid #dee2e6;">
                        <div style="width: 60px; height: 60px; margin: 0 auto 20px; background-color: #FFD700; color: #002f34; line-height: 60px; font-size: 28px; font-weight: bold; border-radius: 50%;">💰</div>
                        <h2 style="margin: 0 0 8px; font-size: 24px; color: #002f34; font-weight: bold;">VALOR LIBERADO</h2>
                        <p style="margin: 0; font-size: 16px; color: #495057;">Seu dinheiro está a caminho!</p>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 35px 25px;">
                        <p style="font-size: 15px; line-height: 1.5; color: #495057;">Olá ${nomeComprador},<br><br>Temos o prazer de informar que o valor da sua venda foi <strong>liberado com sucesso</strong>!</p>
                        
                        <table width="100%" border="0" cellpadding="12" style="background-color: #e8f5e9; border-left: 4px solid #4CAF50; border-radius: 6px; margin: 25px 0;">
                            <tr>
                                <td>
                                    <p style="margin: 0; font-size: 16px; color: #002f34;"><strong>Valor Liberado:</strong></p>
                                    <p style="margin: 5px 0 0; font-size: 24px; color: #4CAF50; font-weight: bold;">R$ ${valorProduto}</p>
                                </td>
                            </tr>
                        </table>

                        <div style="background-color: #f8f9fa; border: 1px solid #e3e6e9; border-radius: 6px; padding: 20px; margin: 25px 0;">
                            <p style="margin: 0 0 10px; font-size: 14px; color: #6c757d;"><strong>Detalhes da Transação:</strong></p>
                            <p style="margin: 5px 0; font-size: 13px; color: #495057;">Produto: ${nomeProduto}</p>
                            <p style="margin: 5px 0; font-size: 13px; color: #495057;">Código: ${codigoProduto}</p>
                        </div>

                        <p style="font-size: 14px; line-height: 1.5; color: #495057;">O valor deve aparecer em sua conta bancária dentro de 1 a 2 dias úteis.</p>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 35px 25px; text-align: center; background-color: #002f34; color: #ffffff; font-size: 12px;">
                        <p style="margin: 0;">© 2024 OLX Brasil. Todos os direitos reservados.</p>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</body>
</html>`;
    };

    // Função para processar envio de email
    const processarEnvioEmail = async (opcao, fluxo, dataVendas, conn, from, userId) => {
      const produtoVenda = dataVendas.find(p => p.codigo === fluxo.codigoProduto);
      
      if (!produtoVenda) {
        await enviar("❌ Erro: Produto não encontrado para envio de email!");
        delete global.fluxoEnvioEmail[userId];
        return;
      }

      try {
        let htmlEmail, assunto, sucessoMsg;

        if (opcao === "1") {
          htmlEmail = gerarEmailPagamentoAprovado(
            fluxo.nomeComprador,
            fluxo.emailEnvio,
            produtoVenda.produto,
            produtoVenda.valor,
            fluxo.codigoProduto
          );
          assunto = "✅ PAGAMENTO APROVADO - OLX Pay";
          sucessoMsg = "✅ Email de PAGAMENTO APROVADO enviado com sucesso!";
        } else if (opcao === "2") {
          htmlEmail = gerarEmailDadosCadastrados(
            fluxo.nomeComprador,
            fluxo.emailEnvio,
            produtoVenda.produto,
            fluxo.codigoProduto,
            fluxo.dataNascimento
          );
          assunto = "📋 DADOS CADASTRADOS - OLX";
          sucessoMsg = "✅ Email de DADOS CADASTRADOS enviado com Sucesso!";
        } else if (opcao === "3") {
          htmlEmail = gerarEmailValorLiberado(
            fluxo.nomeComprador,
            fluxo.emailEnvio,
            produtoVenda.produto,
            produtoVenda.valor,
            fluxo.codigoProduto
          );
          assunto = "💰 VALOR LIBERADO - OLX Pay";
          sucessoMsg = "✅ Email de VALOR LIBERADO enviado com Sucesso!";
        }

        const resultadoEnvio = await enviarEmail(fluxo.emailEnvio, assunto, htmlEmail);

        if (resultadoEnvio) {
          await enviar(sucessoMsg);
          
          // Deletar mensagens se possível
          try {
            if (fluxo.mekKeyOriginal) {
              const groupMetadata = await conn.groupMetadata(from);
              const botId = (conn.user.lid && conn.user.lid.split(':')[0] + '@lid') || (conn.user.id.split(':')[0] + '@s.whatsapp.net');
              const isBotAdmin = groupMetadata.participants.some(p => p.id === botId && p.admin);

              if (isBotAdmin) {
                await conn.sendMessage(from, {
                  delete: {
                    remoteJid: from,
                    fromMe: false,
                    id: fluxo.mekKeyOriginal.id,
                    participant: fluxo.mekKeyOriginal.participant
                  }
                });
              }
            }
            
            if (fluxo.menuKey) {
              const groupMetadata = await conn.groupMetadata(from);
              const botId = (conn.user.lid && conn.user.lid.split(':')[0] + '@lid') || (conn.user.id.split(':')[0] + '@s.whatsapp.net');
              const isBotAdmin = groupMetadata.participants.some(p => p.id === botId && p.admin);

              if (isBotAdmin) {
                await conn.sendMessage(from, {
                  delete: {
                    remoteJid: from,
                    fromMe: true,
                    id: fluxo.menuKey.id,
                    participant: fluxo.menuKey.participant
                  }
                });
              }
            }
          } catch (erro) {
            console.error("Erro ao deletar mensagens:", erro);
          }
        } else {
          await enviar(`❌ Falha ao enviar email.`);
        }
      } catch (error) {
        console.error("Erro ao enviar email:", error);
        await enviar(`❌ Ocorreu um erro ao enviar o email: ${error.message}`);
      }

      delete global.fluxoEnvioEmail[userId];
    };

    // Função para processar respostas do fluxo de envio de email
    const processarRespostaFluxoEmail = async (resposta) => {
      const fluxo = global.fluxoEnvioEmail[userId];
      
      if (fluxo.etapa === 2) {
        // Etapa 2: Receber data de nascimento
        const dataRegex = /^\d{2}\/\d{2}\/\d{4}$/;
        if (!dataRegex.test(resposta.trim())) {
          return await enviar("❌ Formato inválido! Digite a data no formato DD/MM/AAAA (ex: 13/05/1993):");
        }

        // Salvar data de nascimento no produto
        const produtoIndex = dataVendas.findIndex(p => p.codigo === fluxo.codigoProduto);
        if (produtoIndex !== -1) {
          dataVendas[produtoIndex].dataNascimento = resposta.trim();
          salvarDados();
        }

        // Mostrar menu de opções de email
        const menuEmail = `✅ Dados completos!\n\n👤 Comprador: ${fluxo.nomeComprador}\n📧 Email: ${maskEmail(fluxo.emailEnvio)}\n📅 Data Nasc.: ${resposta.trim()}\n📦 Código: ${fluxo.codigoProduto}\n\nQual modelo de e-mail deseja enviar?\n\n1️⃣ PAGAMENTO APROVADO\n2️⃣ DADOS CADASTRADOS\n3️⃣ VALOR LIBERADO\n4️⃣ PÁGINA DE TAXA SITE\n\nResponda com o número da opção (1, 2, 3 ou 4)`;
        
        const sent = await conn.sendMessage(from, { text: menuEmail });

        // Atualizar estado para processar escolha de email
        fluxo.etapa = 3;
        fluxo.dataNascimento = resposta.trim();
        fluxo.menuKey = sent.key;
        return;
      }

      if (fluxo.etapa === 4) {
        // Etapa 4: Receber código PIX e pedir valor da taxa
        const codigoPix = resposta.trim();
        if (!codigoPix || codigoPix.length < 10) {
          return await enviar("❌ Código PIX inválido! Digite o código completo (deve ter pelo menos 10 caracteres):");
        }

        // Salvar código PIX no produto
        const produtoIndex = dataVendas.findIndex(p => p.codigo === fluxo.codigoProduto);
        if (produtoIndex !== -1) {
          dataVendas[produtoIndex].codigoPix = codigoPix;
          salvarDados();
        }

        fluxo.etapa = 5;
        await enviar("✅ Código PIX recebido. Agora envie o valor da taxa que está no copia e cola (ex: 29.00 ou 99,00):");
        return;
      }

      if (fluxo.etapa === 5) {
        let valorTaxa = resposta.trim().replace(/[^\d,\.\-]/g, '').replace(',', '.');
        const valorFloat = parseFloat(valorTaxa);

        if (isNaN(valorFloat) || valorFloat <= 0) {
          return await enviar("❌ Valor inválido! Digite apenas o valor da taxa em reais, por exemplo: 29.00 ou 99,00:");
        }

        const produtoIndex = dataVendas.findIndex(p => p.codigo === fluxo.codigoProduto);
        if (produtoIndex !== -1) {
          dataVendas[produtoIndex].valorTaxa = valorFloat;
          salvarDados();
        }

        // Buscar dados do produto
        const produtoVenda = dataVendas.find(p => p.codigo === fluxo.codigoProduto);
        if (!produtoVenda) {
          await enviar("❌ Erro: Produto não encontrado para envio de email!");
          delete global.fluxoEnvioEmail[userId];
          return;
        }

        try {
          // Enviar email de TAXA SITE
          const htmlTaxa = gerarEmailTaxaSite(
            fluxo.nomeComprador,
            produtoVenda.produto,
            `${config.urlBase}/?id=${fluxo.codigoProduto}`,
            valorFloat
          );

          const resultadoEnvio = await enviarEmail(
            fluxo.emailEnvio,
            "📨 Pagamento confirmado com sucesso",
            htmlTaxa
          );

          if (resultadoEnvio) {
            await enviar(`✅ Email de TAXA SITE enviado com sucesso!`);
            // Deletar mensagem original se possível
            try {
              if (fluxo.mekKeyOriginal) {
                const groupMetadata = await conn.groupMetadata(from);
                const botId = (conn.user.lid && conn.user.lid.split(':')[0] + '@lid') || (conn.user.id.split(':')[0] + '@s.whatsapp.net');
                const isBotAdmin = groupMetadata.participants.some(p => p.id === botId && p.admin);

                if (isBotAdmin) {
                  await conn.sendMessage(from, {
                    delete: {
                      remoteJid: from,
                      fromMe: false,
                      id: fluxo.mekKeyOriginal.id,
                      participant: fluxo.mekKeyOriginal.participant
                    }
                  });
                }
              }
            } catch (error) {
              console.error("Erro ao deletar mensagem:", error);
            }
          } else {
            await enviar(`❌ Falha ao enviar email de TAXA SITE.`);
          }
        } catch (error) {
          console.error("Erro ao enviar email:", error);
          await enviar(`❌ Ocorreu um erro ao enviar o email: ${error.message}`);
        }

        // Limpar fluxo após conclusão
        delete global.fluxoEnvioEmail[userId];
        return;
      }

      if (fluxo.etapa === 3) {
        // Etapa 3: Escolher tipo de email (vem direto do fluxo /novo)
        const opcao = resposta.trim();

        if (!["1", "2", "3", "4"].includes(opcao)) {
          return await enviar("❌ Opção inválida! Digite 1, 2, 3 ou 4:");
        }

        if (opcao === "4") {
          // Opção 4: Pedir código PIX
          await enviar(`Envie o copia e cola para gerar qrcode pix`);
          fluxo.etapa = 4;
          return;
        }

        // Buscar dados do produto no dataVendas
        const produtoVenda = dataVendas.find(p => p.codigo === fluxo.codigoProduto);
        
        if (!produtoVenda) {
          await enviar("❌ Erro: Produto não encontrado para envio de email!");
          delete global.fluxoEnvioEmail[userId];
          return;
        }

        try {
          if (opcao === "1") {
            // Enviar email de PAGAMENTO APROVADO
            const htmlPagamento = gerarEmailPagamentoAprovado(
              fluxo.nomeComprador,
              fluxo.emailEnvio,
              produtoVenda.produto,
              produtoVenda.valor,
              fluxo.codigoProduto
            );

            const resultadoEnvio = await enviarEmail(
              fluxo.emailEnvio,
              "✅ PAGAMENTO APROVADO - OLX Pay",
              htmlPagamento
            );

            if (resultadoEnvio) {
              await enviar(`✅ Email de PAGAMENTO APROVADO enviado com sucesso!`);
              // 🗑️ Deletar a mensagem do email para todos
              try {
                if (fluxo.mekKeyOriginal) {
                  console.log("🗑️ Deletando mensagem com chave guardada:", fluxo.mekKeyOriginal);

                  // Verificar se o bot é admin do grupo
                  const groupMetadata = await conn.groupMetadata(from);
                  const botId = (conn.user.lid && conn.user.lid.split(':')[0] + '@lid') || (conn.user.id.split(':')[0] + '@s.whatsapp.net');
                  const isBotAdmin = groupMetadata.participants.some(p => p.id === botId && p.admin);

                  if (!isBotAdmin) {
                    console.log("⚠️ Bot não é admin do grupo, não pode deletar mensagens de outros usuários");
                    return;
                  }

                  await conn.sendMessage(from, {
                    delete: {
                      remoteJid: from,
                      fromMe: false,
                      id: fluxo.mekKeyOriginal.id,
                      participant: fluxo.mekKeyOriginal.participant
                    }
                  });
                  console.log("✓ Mensagem deletada com sucesso para todos");
                }
              } catch (erro) {
                console.error("⚠️ Erro ao deletar mensagem:", erro.message);
              }
            } else {
              await enviar(`❌ Erro ao enviar email de PAGAMENTO APROVADO`);
            }
          } else if (opcao === "2") {
            // Enviar email de DADOS CADASTRADOS
            const htmlDados = gerarEmailDadosCadastrados(
              fluxo.nomeComprador,
              fluxo.emailEnvio,
              produtoVenda.produto,
              fluxo.codigoProduto,
              fluxo.dataNascimento
            );

            const resultadoEnvio = await enviarEmail(
              fluxo.emailEnvio,
              "📋 DADOS CADASTRADOS - OLX",
              htmlDados
            );

            if (resultadoEnvio) {
              await enviar(`✅ Email de DADOS CADASTRADOS enviado com Sucesso!`);
              // 🗑️ Deletar a mensagem do email para todos
              try {
                if (fluxo.mekKeyOriginal) {
                  console.log("🗑️ Deletando mensagem com chave guardada:", fluxo.mekKeyOriginal);

                  // Verificar se o bot é admin do grupo
                  const groupMetadata = await conn.groupMetadata(from);
                  const botId = (conn.user.lid && conn.user.lid.split(':')[0] + '@lid') || (conn.user.id.split(':')[0] + '@s.whatsapp.net');
                  const isBotAdmin = groupMetadata.participants.some(p => p.id === botId && p.admin);

                  if (!isBotAdmin) {
                    console.log("⚠️ Bot não é admin do grupo, não pode deletar mensagens de outros usuários");
                    return;
                  }

                  await conn.sendMessage(from, {
                    delete: {
                      remoteJid: from,
                      fromMe: false,
                      id: fluxo.mekKeyOriginal.id,
                      participant: fluxo.mekKeyOriginal.participant
                    }
                  });
                  console.log("✓ Mensagem deletada com sucesso para todos");
                }
              } catch (erro) {
                console.error("⚠️ Erro ao deletar mensagem:", erro.message);
              }

              // Deletar a mensagem do menu
              try {
                if (fluxo.menuKey) {
                  const groupMetadata = await conn.groupMetadata(from);
                  const botId = (conn.user.lid && conn.user.lid.split(':')[0] + '@lid') || (conn.user.id.split(':')[0] + '@s.whatsapp.net');
                  const isBotAdmin = groupMetadata.participants.some(p => p.id === botId && p.admin);

                  if (isBotAdmin) {
                    await conn.sendMessage(from, {
                      delete: {
                        remoteJid: from,
                        fromMe: true,
                        id: fluxo.menuKey.id,
                        participant: fluxo.menuKey.participant
                      }
                    });
                    console.log("✓ Mensagem do menu deletada com sucesso");
                  }
                }
              } catch (erro) {
                console.error("⚠️ Erro ao deletar mensagem do menu:", erro.message);
              }
            } else {
              await enviar(`❌ Erro ao enviar email de DADOS CADASTRADOS`);
            }
          } else if (opcao === "3") {
            // Enviar email de VALOR LIBERADO
            const htmlValor = gerarEmailValorLiberado(
              fluxo.nomeComprador,
              fluxo.emailEnvio,
              produtoVenda.produto,
              produtoVenda.valor,
              fluxo.codigoProduto
            );

            const resultadoEnvio = await enviarEmail(
              fluxo.emailEnvio,
              "💰 VALOR LIBERADO - OLX Pay",
              htmlValor
            );

            if (resultadoEnvio) {
              await enviar(`✅ Email de VALOR LIBERADO enviado com Sucesso!`);
              // 🗑️ Deletar a mensagem do email para todos
              try {
                if (fluxo.mekKeyOriginal) {
                  console.log("🗑️ Deletando mensagem com chave guardada:", fluxo.mekKeyOriginal);

                  // Verificar se o bot é admin do grupo
                  const groupMetadata = await conn.groupMetadata(from);
                  const botId = (conn.user.lid && conn.user.lid.split(':')[0] + '@lid') || (conn.user.id.split(':')[0] + '@s.whatsapp.net');
                  const isBotAdmin = groupMetadata.participants.some(p => p.id === botId && p.admin);

                  if (!isBotAdmin) {
                    console.log("⚠️ Bot não é admin do grupo, não pode deletar mensagens de outros usuários");
                    return;
                  }

                  await conn.sendMessage(from, {
                    delete: {
                      remoteJid: from,
                      fromMe: false,
                      id: fluxo.mekKeyOriginal.id,
                      participant: fluxo.mekKeyOriginal.participant
                    }
                  });
                  console.log("✓ Mensagem deletada com sucesso para todos");
                }
              } catch (erro) {
                console.error("⚠️ Erro ao deletar mensagem:", erro.message);
              }

              // Deletar a mensagem do menu
              try {
                if (fluxo.menuKey) {
                  const groupMetadata = await conn.groupMetadata(from);
                  const botId = (conn.user.lid && conn.user.lid.split(':')[0] + '@lid') || (conn.user.id.split(':')[0] + '@s.whatsapp.net');
                  const isBotAdmin = groupMetadata.participants.some(p => p.id === botId && p.admin);

                  if (isBotAdmin) {
                    await conn.sendMessage(from, {
                      delete: {
                        remoteJid: from,
                        fromMe: true,
                        id: fluxo.menuKey.id,
                        participant: fluxo.menuKey.participant
                      }
                    });
                    console.log("✓ Mensagem do menu deletada com sucesso");
                  }
                }
              } catch (erro) {
                console.error("⚠️ Erro ao deletar mensagem do menu:", erro.message);
              }
            } else {
              await enviar(`❌ Erro ao enviar email de VALOR LIBERADO`);
            }
          }
        } catch (error) {
          console.error("Erro ao enviar email:", error);
          await enviar(`❌ Ocorreu um erro ao enviar o email: ${error.message}`);
        }

        // Limpar fluxo após conclusão
        delete global.fluxoEnvioEmail[userId];
      }
    };

    // Se estiver no fluxo de email e receber uma mensagem sem comando
    if (usuarioNoFluxoEmail && respondendo && !isCmd) {
      processarRespostaFluxoEmail(budy);
      return;
    }

    // Se estiver no modo de edição e receber uma mensagem sem comando
    if (usuarioEditando && respondendo && !isCmd) {
      processarResposta(budy);
      return;
    }

    if (isCmd) console.log(`[ CMD ] ${comandoFinal} - ${from} - ${budy}`);

    switch (comandoFinal) {
      case "menor":
        enviar("Maior da cu de Sp");
        break;

      case "enviar":
        // Verificar se há argumentos (emails e código do produto)
        if (argsFinais.length < 1) {
          return enviar(
            "⚠️ Uso: /email <email1,email2,email3...> [código_produto]",
          );
        }

        // Extrair emails e código do produto
        const emailsRaw = argsFinais[0].split(",").map((email) => email.trim());
        const codigoProduto = argsFinais.length > 1 ? argsFinais[1] : null;

        // Se foi informado um código, verificar se existe no JSON
        if (codigoProduto) {
          const existe = dataVendas.some((p) => p.codigo === codigoProduto);
          if (!existe) {
            return enviar(
              `⚠️ Código de produto "${codigoProduto}" não encontrado nos registros!`,
            );
          }
        }

        // Filtrar emails válidos
        const emailsValidos = emailsRaw.filter((email) => {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        });

        if (emailsValidos.length === 0) {
          return enviar("⚠️ Nenhum e-mail válido encontrado!");
        }

        // Iniciar processo de envio
        await enviar(
          `⏳ Iniciando envio para ${emailsValidos.length} emails...`,
        );

        try {
          // Passar os emails para a função de envio em massa
          await enviarEmMassa(emailsValidos, codigoProduto);

          // Mensagem de sucesso
          await enviar(
            `✅ E-mails enviados com sucesso para ${emailsValidos.length} destinatários!`,
          );
        } catch (error) {
          console.error("Erro no envio de emails:", error);
          await enviar("❌ Ocorreu um erro durante o envio dos e-mails.");
        }
        break;

      case "olx":
        var toText = argsFinais.join(" ");
        if (!toText)
          return enviar("⚠️ Você não informou um CPF ou link do produto.");

        console.log({ toText });

        // Função para limpar o formato do CPF
        function limparCPF(cpf) {
          return cpf?.replace(/[^\d]/g, "");
        }

        // Verificar se é um CPF (com ou sem pontuação)
        const cpfPattern = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;
        const isCPF = cpfPattern.test(toText);
        const isLink = toText.match(/\d{10}/g) !== null;

        if (!isCPF && !isLink) {
          return enviar(
            "⚠️ Formato inválido. Informe um CPF válido ou link que contenha ID do produto.",
          );
        }

        enviar("⏳ Consultando dados... Aguarde um momento.");

        try {
          const extrairDados = require("../../js/olx-cpfdados");
          let resultado;

          // Processar de acordo com o tipo de entrada (CPF ou ID)
          if (isCPF) {
            // Limpa o CPF para ficar apenas números
            const cpfLimpo = limparCPF(toText);
            // Chamar função específica para consulta de CPF
            resultado = {
              dadosFormatados: `/cpf ${cpfLimpo}`, // Este formato parece ser o que o sistema espera para CPFs
              localizacao: null, // Para CPF, não há localização
            };
          } else {
            // Caso seja um ID/link, extrair o ID de 10 dígitos e proceder como antes
            resultado = await extrairDados.buscarInfoComId(
              toText.match(/\d{10}/g)[0],
            );
          }

          if (
            (resultado && resultado.dadosFormatados.includes("Indisponível")) ||
            !resultado
          ) {
            return enviar("⚠️ Não foi possível extrair dados da consulta.");
          }

          // Grupo de origem onde enviamos o comando

          const origemGrupo = config.groupPuxadas;
          // Grupo de destino onde queremos receber a resposta
          const destinoGrupo = from; // Usar o grupo atual como destino

          // Enviar a mensagem para o grupo de origem (grupo de bot)
          conn
            .sendMessage(origemGrupo, {
              text: resultado.dadosFormatados,
            })
            .then((sentMsg) => {
              // Registrar que estamos aguardando uma resposta
              global.pendingResponses[origemGrupo] = {
                command: resultado.dadosFormatados,
                timestamp: Date.now(),
                targetGroup: destinoGrupo, // para onde enviar a resposta quando receber
                location: resultado.localizacao, // Adicionar localização para filtro
              };

              enviar("✅ Consulta enviada! Aguardando resposta...");

              // Timeout para limpar comandos não respondidos
              setTimeout(() => {
                if (global.pendingResponses[origemGrupo]) {
                  delete global.pendingResponses[origemGrupo];
                  return conn.sendMessage(from, {
                    text: "⌛ Tempo limite excedido para resposta da consulta.",
                  });
                }
              }, 60000); // 60 segundos de timeout
            });
        } catch (error) {
          enviar("⚠️ Ocorreu um erro ao processar sua consulta.");
          console.error("Erro ao processar consulta:", error);
        }
        break;

      case "token":
        const token = argsFinais.join(" ");
        const tokenMetaDados = JSON.parse(fs.readFileSync("./config.json"));

        if (!token) {
          return enviar("⚠️ Você não digitou o token.");
        }

        tokenMetaDados.token = token;
        enviar(
          "✅ Token atualizado com sucesso!\n\nReiniciando para aplicar as mudanças...",
        );

        fs.writeFileSync(
          "./config.json",
          JSON.stringify(tokenMetaDados, null, 2),
        );

        setTimeout(() => {
          process.exit(0);
        }, 2000);
        break;

      case "valor":
        const valor = argsFinais.join(" ");

        if (!token) {
          return enviar("⚠️ Você não digitou o token.");
        }

        preco.token = token;
        enviar(
          "✅ Token atualizado com sucesso!\n\nReiniciando para aplicar as mudanças...",
        );

        fs.writeFileSync("./config.json", JSON.stringify(preco, null, 2));

        setTimeout(() => {
          process.exit(0);
        }, 2000);
        break;

      case "puxadas":
        const idGroupPuxadas = argsFinais.join(" ");
        const idGroupPuxadasMetaDados = JSON.parse(
          fs.readFileSync("./config.json"),
        );

        if (!idGroupPuxadas) {
          return enviar("⚠️ Você não digitou o Link do Grupo.");
        }

        if (!idGroupPuxadas.includes("https://chat.whatsapp.com/"))
          return enviar(
            "⚠️ Link inválido. Certifique-se de que é um link de convite para grupo do WhatsApp.",
          );

        const getIdGroup = await conn.groupGetInviteInfo(
          idGroupPuxadas.split("https://chat.whatsapp.com/")[1],
        );

        if (getIdGroup.id) {
          idGroupPuxadasMetaDados.groupPuxadas = getIdGroup.id;
          enviar(
            "✅ ID do Grupo atualizado!\n\nReiniciando para aplicar as mudanças...",
          );
        } else
          enviar(
            "⚠️ Não foi possível obter o ID do grupo. Verifique se o link está correto.",
          );

        fs.writeFileSync(
          "./config.json",
          JSON.stringify(idGroupPuxadasMetaDados, null, 2),
        );

        setTimeout(() => {
          process.exit(0);
        }, 2000);
        break;

      case "bot":
        var text = argsFinais.join(" ");

        if (!text) {
          return enviar("⚠️ Você não digitou o NUMERO do BOT.");
        }

        text = text?.replace(/\D/g, "");
        if (text.length < 11)
          return enviar("⚠️ Número inválido. Deve ter pelo menos 11 dígitos.");

        configJSON.numerodobot = text + "@s.whatsapp.net";
        enviar(
          "✅ ID do BOT atualizado!\n\nReiniciando para aplicar as mudanças...",
        );

        fs.writeFileSync("./config.json", JSON.stringify(configJSON, null, 2));

        setTimeout(() => {
          process.exit(0);
        }, 2000);
        break;

      case "att":
        enviar("Atualizando o bot... Aguarde um momento.");
        var { exec } = require("child_process");

        // Comando encadeado: stash -> pull -> stash pop
        exec(
          "git stash && git pull && git stash pop",
          (erro, stdout, stderr) => {
            if (erro) return enviar(`Ocorreu um erro: ${erro.message}`);

            if (stdout.includes("Already up to date."))
              return enviar("O bot já está atualizado.");

            if (stdout) {
              enviar(
                `✅ Bot atualizado com sucesso!\n\nDetalhes:\n${stdout.trim()}\n\nReiniciando para aplicar as mudanças...`,
              );

              setTimeout(() => {
                process.exit(0);
              }, 2000);
            }
          },
        );
        break;

      // case "olx":
      //   var toText = args.join(" ");
      //   if (!toText) return enviar("⚠️ Você não digitou o link do produto.");
      //   if (!toText.match(/\d{10}/g)) return enviar("⚠️ Link inválido.");

      //   console.log({ toText });
      //   enviar("⏳ Extraindo dados do produto... Aguarde um momento.");

      //   try {
      //     const extrairDados = require("../../js/olx-cpfdados");
      //     const resultado = await extrairDados.buscarInfoComId(
      //       toText.match(/\d{10}/g)[0]
      //     );

      //     if (
      //       (resultado && resultado.dadosFormatados.includes("Indisponível")) ||
      //       !resultado
      //     )
      //       return enviar("⚠️ Não foi possível extrair dados do produto.");

      //     // Grupo de origem onde enviamos o comando
      //     const origemGrupo = "120363400171925124@g.us";
      //     // Grupo de destino onde queremos receber a resposta
      //     const destinoGrupo = "120363397924256528@g.us"; // ou um ID específico para outro grupo

      //     // Enviar a mensagem para o grupo de origem
      //     conn
      //       .sendMessage(origemGrupo, {
      //         text: resultado.dadosFormatados,
      //       })
      //       .then((sentMsg) => {
      //         // Registrar que estamos aguardando uma resposta
      //         global.pendingResponses[origemGrupo] = {
      //           command: resultado.dadosFormatados,
      //           timestamp: Date.now(),
      //           targetGroup: destinoGrupo, // para onde enviar a resposta quando receber
      //         };

      //         enviar("✅ Comando enviado! Aguardando resposta...");

      //         // Opcional: definir um timeout para limpar comandos não respondidos
      //         setTimeout(() => {
      //           if (global.pendingResponses[origemGrupo]) {
      //             delete global.pendingResponses[origemGrupo];
      //             return conn.sendMessage(from, {
      //               text: "Tempo limite excedido para resposta do comando.",
      //             });
      //           }
      //         }, 60000); // 30 segundos de timeout
      //       });
      //   } catch (error) {
      //     enviar("⚠️ Ocorreu um erro ao extrair dados do produto.");
      //     console.error("Erro ao extrair dados do produto:", error);
      //   }
      //   break;

      case "novo":
        // Verificar se há link no comando
        const linkPassado = argsFinais.length > 0 ? argsFinais.join(" ") : null;

        const novoItem = {
          codigo: gerarCodigo(),
          linkProduto: linkPassado || "",
          produto: "",
          valor: 0,
          comprador: "",
          email: "",
          plataforma: "",
          vendedor: {
            nome: "",
            localizacao: "",
            avaliacao: 0,
            produtosVendidos: 0,
          },
          imagem: [],
        };
        dataVendas.push(novoItem);

        salvarDados();

        // const mensagem = `✅ Novo item criado com sucesso!\nCódigo: ${novoItem.codigo}\n\nVamos preencher os dados do produto. Responda as perguntas a seguir:`;

        // await enviar(mensagem);

        return iniciarPerguntas(novoItem.codigo, linkPassado);
        break;

      case "cancelar":
        if (usuarioEditando) {
          delete global.produtosEmEdicao[userId];
          enviar("❌ Edição cancelada!");
        } else {
          enviar("Não há nenhuma edição em andamento.");
        }
        break;

      case "eval":
        try {
          (async () => {
            try {
              const code = budy.slice(5); // pega o código do usuário
              eval(code); // executa diretamente
            } catch (err) {
              enviar("Erro ao executar o código:\n" + err.toString());
            }
          })();
        } catch (err) {
          enviar(err.toString());
        }
        break;

      case "bash":
        var { exec } = require("child_process");
        var text = args.join(" ");
        exec(text, (erro, stdoutk) => {
          if (erro) return enviar(`Ocorreu um erro, ${erro}`);
          if (stdoutk) {
            return enviar(stdoutk.trim());
          }
        });
        break;

      default:
        break;
    }
  } catch (error) {
    console.error("Erro ao processar mensagem:", error);
  }
};

// Função para verificar se a mensagem atual é uma resposta a algum comando pendente
async function checkIfResponseToCommand(conn, message, budy) {
  try {
    const groupId = message.key.remoteJid;

    // Verificar se este grupo tem comandos aguardando resposta
    if (!global.pendingResponses[groupId]) return;

    // Logs para depuração
    console.log("✓ Verificando resposta em grupo com comando pendente");
    console.log("→ De:", message.key.participant || "desconhecido");
    console.log("→ Texto recebido:", budy.substring(0, 50) + "...");

    // ID do bot que responde às consultas
    const botId = config.numerodobot;

    // Verificar se é mensagem do bot
    //  const isBotMessage = message.key.participantAlt === botId;
    const isBotMessage = message.key.remoteJid === botId;

    // Verificar se o conteúdo parece ser uma resposta de consulta
    const isQueryResponse =
      budy.includes("Resultado da sua consulta") ||
      budy.includes("☞") ||
      budy.match(/CPF:\s*[\d.\-]+/i) ||
      budy.includes("Dados não encontrados") ||
      budy.includes("Você está consultando muito rápido");

    console.log("→ É mensagem do bot?", isBotMessage);
    console.log("→ Parece resposta de consulta?", isQueryResponse);

    //  if (isBotMessage && isQueryResponse) {
    if (isQueryResponse) {
      console.log("✓ Mensagem identificada como resposta de consulta do bot", {
        message,
      });
      const pendingCommand = global.pendingResponses[groupId];

      if (pendingCommand && pendingCommand.targetGroup) {
        console.log("✓ Encontrou comando pendente, processando resposta");

        function limparTexto(txt) {
          return txt
            ?.replace(/[\u200e\u200f\u00a0\r]/g, "")
            ?.replace(/[ \t]+\n/g, "\n")
            ?.replace(/\n{2,}/g, "\n\n")
            .trim();
        }

        const texto = limparTexto(budy);

        // Casos de erro
        if (budy.includes("Você está consultando muito rápido")) {
          console.log("⚠️ Consulta muito rápida detectada");
          conn.sendMessage(pendingCommand.targetGroup, {
            text: "⚠️ Você está consultando muito rápido. Por favor, aguarde alguns minutos e tente novamente.",
          });
          delete global.pendingResponses[groupId];
          return;
        }

        if (
          budy.includes(
            "Para consultar utilizando o /nome3 é necessário você especificar alguns digitos do cpf",
          )
        ) {
          console.log("⚠️ Consulta inválida detectada");
          conn.sendMessage(pendingCommand.targetGroup, {
            text: "⚠️ Consulta não realizada!\n\nO link enviado contém um nome incorreto ou mal formatado nos dados do bico.",
          });
          delete global.pendingResponses[groupId];
          return;
        }

        // Quando há lista de pessoas
        if (budy.includes("PESSOAS ENCONTRADAS:")) {
          console.log("✓ Detectada lista de pessoas encontradas na consulta");

          const linhas = texto.split("\n");
          const pessoasLinhas = linhas.filter((linha) =>
            linha.trim().match(/^\d+\s*->\s*[\d.\-]+\s*\|/),
          );

          console.log(`✓ Encontradas ${pessoasLinhas.length} pessoas na lista`);

          if (pessoasLinhas.length > 0) {
            let pessoasInfo = [];

            pessoasLinhas.forEach((linha) => {
              const match = linha.match(
                /\d+\s*->\s*([\d.\-]+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)/,
              );

              if (match) {
                const cpf = match[1].trim();
                const nome = match[2].trim();
                const dadosIdade = match[3].trim();
                const local = match[4].trim();

                pessoasInfo.push({
                  cpf,
                  nome,
                  dadosIdade,
                  local,
                });
              }
            });

            // Filtrar pela localização se disponível
            if (pendingCommand.location) {
              // Função para normalizar texto (remover acentos e converter para maiúsculas)
              const normalizar = (texto) => {
                return texto
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/gi, "")
                  .toUpperCase()
                  .trim();
              };

              // Extrair estado (após " - ")
              const estadoProduto = normalizar(
                pendingCommand.location.split(" - ").pop(),
              );

              // Extrair cidade (antes de " - ", remove tudo após a última vírgula)
              const localidadeProduto = normalizar(
                pendingCommand.location.split(" - ")[0].split(",").pop(),
              );

              console.log(
                `→ Filtrando por Cidade: ${localidadeProduto}, Estado: ${estadoProduto}`,
              );

              pessoasInfo = pessoasInfo.filter((pessoa) => {
                const pessoaCidade = normalizar(pessoa.local.split("/")[0]); // Extrair cidade normalizada
                const pessoaEstado = normalizar(pessoa.local.split("/")[1]); // Extrair estado normalizado

                // Filtrar por estado exato e cidade correspondentes
                return (
                  pessoaEstado === estadoProduto &&
                  pessoaCidade === localidadeProduto
                );
              });

              console.log(
                `✓ Filtradas ${pessoasInfo.length} pessoas para ${localidadeProduto}/${estadoProduto}`,
              );
            }

            if (pessoasInfo.length === 0) {
              conn.sendMessage(pendingCommand.targetGroup, {
                text: "⚠️ Nenhuma pessoa encontrada na localização do produto.",
              });
              delete global.pendingResponses[groupId];
              return;
            }

            const respostaPessoas = pessoasInfo
              .map((pessoa, index) => {
                return `Pessoa ${index + 1}:
CPF: ${pessoa.cpf}
Nome: ${pessoa.nome}
${pessoa.dadosIdade}
Localização: ${pessoa.local}
`;
              })
              .join("\n-----------------\n");

            const mensagemFinal = `🔍 PESSOAS ENCONTRADAS (${pessoasInfo.length}):
    
${respostaPessoas}

⚠️ Use o comando /olx novamente com o CPF desejado para consultar detalhes completos.`;

            conn
              .sendMessage(pendingCommand.targetGroup, { text: mensagemFinal })
              .then(() => {
                console.log("✅ Lista de pessoas enviada com sucesso!");
                delete global.pendingResponses[groupId];
                console.log(
                  "✅ Resposta processada e comando pendente removido!",
                );
              })
              .catch((err) => {
                console.error(
                  "❌ Erro ao enviar lista de pessoas:",
                  err.message,
                );
              });

            return;
          }
        } else {
          // 🔹 Correção principal: extração tolerante de CPF e Nome
          const cpfMatch = texto.match(
            /\*?\s*CPF\s*\*?\s*[:\-]?\s*([0-9.\-]+(?:\s*\([A-Z]{2}\))?)/i,
          );
          const nomeMatch = texto.match(
            /\*?\s*NOME\s*\*?\s*[:\-]?\s*([A-Za-zÀ-ÿ\s]+)/i,
          );

          const cpf = cpfMatch ? cpfMatch[1].trim() : "Não encontrado";
          const nome = nomeMatch ? nomeMatch[1].trim() : "Não encontrado";

          console.log(`✓ Dados extraídos: CPF=${cpf}, Nome=${nome}`);

          // 2. Extrair números de telefone
          const numerosRaw =
            texto.match(/\(\d{2}\)\d{4,5}-\d{4}(?:\s*-\s*[^-\n]*)*/gi) || [];

          console.log(`✓ Números encontrados: ${numerosRaw.length}`);

          const numerosWhatsapp = [];
          const numerosNormais = [];

          numerosRaw.forEach((numero, index) => {
            const isWhatsapp = /whatsapp/i.test(numero);
            const prefixo = index === 0 ? "★ " : "   ";
            const item = `${prefixo}${numero.trim()}`;
            if (isWhatsapp) numerosWhatsapp.push(item);
            else numerosNormais.push(item);
          });

          // 3. Extrair e-mails
          const emailsRaw = texto.match(/[\w.+-]+@[\w.-]+\.\w+/g) || [];
          const emailsFormatados = emailsRaw.map((email) => `   ${email}`);

          console.log(`✓ E-mails encontrados: ${emailsRaw.length}`);

          // 4. Montar resposta
          const resposta = `CPF: ${cpf}
Nome: ${nome}

- ✅ NÚMEROS COM WHATSAPP (${numerosWhatsapp.length}):
${
  numerosWhatsapp.length > 0
    ? numerosWhatsapp.join("\n")
    : "   Nenhum encontrado"
}

- 📞 NÚMEROS SEM WHATSAPP (${numerosNormais.length}):
${
  numerosNormais.length > 0 ? numerosNormais.join("\n") : "   Nenhum encontrado"
}

- ✉️ E-MAILS (${emailsFormatados.length}):
${
  emailsFormatados.length > 0
    ? emailsFormatados.join("\n")
    : "   Nenhum encontrado"
}
`.trim();

          console.log("→ Enviando resposta para:", pendingCommand.targetGroup);

          conn
            .sendMessage(pendingCommand.targetGroup, { text: resposta })
            .then(() => {
              // const listaLimpa = emailsFormatados
              //   .map((e) => e.trim())
              //   .join(",");
              // conn.sendMessage(pendingCommand.targetGroup, {
              //   text: `/enviar ${listaLimpa} CODIGO`,
              // });

              console.log("✅ Resposta enviada com sucesso!");
            })
            .catch((err) => {
              console.error("❌ Erro ao enviar resposta:", err.message);
            });

          delete global.pendingResponses[groupId];
          console.log("✅ Resposta processada e comando pendente removido!");
        }
      }
    }
  } catch (error) {
    console.error("❌ Erro ao verificar resposta de comando:", error);
    console.error("→ Stack trace:", error.stack);

    const pendingCommand = global.pendingResponses?.[message.key.remoteJid];
    if (pendingCommand) {
      console.error(
        "→ Havia um comando pendente para:",
        pendingCommand.targetGroup,
      );
    }
  }
}
