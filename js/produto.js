const puppeteer = require("puppeteer");

async function extrairDadosProdutoOLX(url) {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // espera seletor que sempre aparece (ajusta se precisar)
    await page
      .waitForSelector("span.typo-body-small.text-neutral-120.font-regular", {
        timeout: 8000,
      })
      .catch(() => {
        /* ignora se não aparecer */
      });
    await page.waitForSelector("h1", { timeout: 8000 }).catch(() => {
      /* ignora se não aparecer */
    });

    const dados = await page.evaluate(() => {
      // helpers (DOM puro)
      const textOf = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.innerText.trim() : null;
      };

      const allTexts = (sel) => {
        const nodes = Array.from(document.querySelectorAll(sel) || []);
        return nodes.map((n) => n.innerText.trim());
      };

      const obterImagens = () =>
        Array.from(document.querySelectorAll("img"))
          .map((img) => img.src)
          .filter((src) => src && src.includes("olx"));

      // pega todos os spans com a classe
      const spans = allTexts(
        "span.typo-body-small.text-neutral-120.font-regular"
      );

      // 1) tentativa direta: segundo span (índice 1)
      let localizacao = spans && spans.length > 1 ? spans[1] : null;

      // 2) fallback: procura um span com vírgula (ex: "Cidade, Estado")
      if (!localizacao) {
        const withComma = spans.find((s) => s && s.includes(","));
        if (withComma) localizacao = withComma;
      }

      // 3) fallback extra: procura pelo SVG de localização (baseado no path único)
      if (!localizacao) {
        try {
          const pathElems = Array.from(document.querySelectorAll("svg path"));
          const match = pathElems.find(
            (p) =>
              p.getAttribute("d") &&
              p.getAttribute("d").includes("17.0444645,19.6408084")
          );
          if (match) {
            // sobe até o container e pega o span dentro dele
            const container = match.closest(".flex") || match.closest("div");
            const span = container
              ? container.querySelector(
                  "span.typo-body-small.text-neutral-120.font-regular"
                )
              : null;
            if (span) localizacao = span.innerText.trim();
          }
        } catch (e) {
          // ignora
        }
      }

      // resultado final
      return {
        titulo: textOf("h1"),
        preco:
          (
            textOf(
              "#price-box-container > div.ad__sc-q5xder-1.hoJpM > div:nth-child(1) > div > span > span"
            ) || ""
          )
            .replace("R$", "")
            .replace(/\./g, "")
            .trim() || null,
        nomeDono: textOf("span.typo-body-large.ad__sc-ypp2u2-4.TTTuh"),
        vendasConcluidas: textOf("span.typo-body-large.font-semibold.mr-0-25"),
        descricao: textOf(
          "#description-title > div > div.ad__sc-2mjlki-0.cbbFAE.olx-d-flex.olx-ai-flex-start.olx-fd-column > div > span > span"
        ),
        localizacao,
        imagens: obterImagens(),
        url: window.location.href,
        dataExtracao: new Date().toISOString(),
      };
    });

    await browser.close();
    console.log("Dados extraídos com sucesso:", dados);
    return { sucesso: true, dados };
  } catch (erro) {
    try {
      await browser.close();
    } catch (e) {
      /* ignora */
    }
    console.error("Erro na extração:", erro);
    return {
      sucesso: false,
      erro: erro.message,
    };
  }
}


module.exports = { extrairDadosProduto: extrairDadosProdutoOLX };
