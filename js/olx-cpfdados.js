const axios = require("axios");
const fs = require("fs");
const cheerio = require("cheerio"); // Adicione esta linha para importar cheerio

// Função para criar a configuração com ID personalizado
function criarConfig(listId) {
  return {
    method: "get",
    maxBodyLength: Infinity,
    url: `https://comprasegura.olx.com.br/?listId=${listId}&source=ADVIEW`,
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      "sec-ch-ua":
        '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "upgrade-insecure-requests": "1",
      referer: "https://pa.olx.com.br/",
      cookie: `r_id=0c37e463-ec02-481e-a64b-f0a195df5965; nl_id=3760142a-67eb-430c-89ef-cba4f37c110b; l_id=9a189615-f425-4e3d-8952-f05a994d7efa; _tt_enable_cookie=1; _ttp=01JX5CXH3MJHRG76NN4S7V776E_.tt.2; _fbp=fb.2.1749306754225.217143965748204928; AdoptVisitorId=MYUwRgrAHAbBAsBaeBDAZi5AGNxEE5gYkBmNMGYfMAE2lCA=; __gsas=ID=5a7a4d56fbc9d03d:T=1749306777:RT=1749306777:S=ALNI_MYa2_UrEUu1SHotUzJxfTgmqS_u9w; _cc_id=193482ed181e153470406e0a8a964807; _hjSessionUser_1425418=eyJpZCI6ImRhMDRhZjRhLTk4OTItNTA1ZC04M2Y1LTk4NTIyYzU3MDU2MCIsImNyZWF0ZWQiOjE3NTA2MjI0MjkwOTIsImV4aXN0aW5nIjp0cnVlfQ==; _ga_E6M9NP0QM5=GS2.3.s1750622429$o1$g1$t1750622562$j60$l0$h0; sf_utm_medium=shared_link; sf_utm_campaign=; sf_utm_content=; sf_utm_term=; __spdt=21a87c0b9056458eba0605c854992b6f; sf_utm_source=direct; _gcl_au=1.1.741772291.1757414318; _ga=GA1.1.1556582239.1749306754; pbjs_sharedId=80e6cfd6-0e70-4738-abfd-c3adfb364be3; pbjs_sharedId_cst=zix7LPQsHA%3D%3D; _clck=3y1zg6%5E2%5Eg0e%5E0%5E2029; _pubcid=fa2a7b32-e306-4996-bce1-49ff8d81797a; _pubcid_cst=zix7LPQsHA%3D%3D; _hjSessionUser_3507498=eyJpZCI6Ijk1ZmExZDlkLTE3ZjctNTVkNC05MmI4LWVlYWE4NGVhZDgwZCIsImNyZWF0ZWQiOjE3NjE1OTk5NTc0NjIsImV4aXN0aW5nIjpmYWxzZX0=; _cfuvid=AHSLgMSMg.52rJozL2JVoYQYIjKCWv2NvjJcC2HfbKQ-1762255359033-0.0.1.1-604800000; SMART_LOCK_STATUS=off; TestAB_Groups=adv-adee01_enabled.payg-discount-re-julius_ml-ranges.tenerity_enabled.sxp-refm_enabled.acc-mt-lg_enabled.adv-lifet1_f3r1-5.sa-ai-fg_D.rec-hf9df0_enabled.sa-new-bff_A.bjTPZ-pr_control.ad-is-far_enabled.ad-coupon_enabled.sa-tradein_enabled.sanityweb50_A.magic-link_control.acc-reput_enabled.ppo-tri_enabled.aa-for-pas_enabled.lnvdeochat_control.Md-shwphne_control.sellerchat_enabled.autos-prc_enabled.re-steps_enabled.aa-device_enabled.lst-re-mp_enabled.sxp-sxatc_sacred.aa-2fa-lab_control.lim-exc-pl_control.ln-gchatv2_A.aa-reval_control.ppf-di-exp_enabled.opt-renew_enabled.aa-verify_enabled.palq1183_enabled.acc-incen_enabled; s_id=cad002cc-b44d-4223-94a5-7baf86a82f8a2025-11-04T15:25:39.210649Z; _lr_env=eyJ0aW1lc3RhbXAiOjE3NjIyNjk5NDQ0NDUsInZlcnNpb24iOiIxLjYuMCIsImVudmVsb3BlIjoiQXVQVGxBWEZNUVR4TDNRQUcwdFQ5UXp6STRTOGFrZnZpZGpJd0l2ekF3Z1hoVWJqY3EtWTZKYUYyV2lXS05zZ0tYaEdTd2lBaG0xZEkwS0JObnk1aWttQ0JadG1UUDdCd2NWNUE0QXdNRVktQmlYTmhYT1A1aHNjNHFOS2hDakZuLWJ6dzhsT0dQSmZ3TFNKV09SLXJvUWpHbnozQ183QzFrUGtEQXVJcnpadzJDYVR6Y1FvSTc1emRCSkx6N0c2MVFBZmZxd1FQcm8xdXphSTl0N2owRGY2YXNiZ0dQSUZtcXU0dXpydnQ4R2JmSXNUNUhSS1UxOXg2NTltaDZOdzZhdFpUTTcxV1J3LWxpTmptTy1PWldxbVp1eERXSWowblNQaFo5dFJmT1E4RWRlS2FHZEp0WDJ5X0dDelN1dVQ3Wm5mT3ZDZE9MakZtQnI0V2NDLTdhOGhwSzVid01MeFBmQk8ydGNfVjJYLXRJZmZqUkh2cFZYZ293IiwiY3JlYXRpb25UaW1lc3RhbXAiOjE3NjIyNTUzNjQzNjF9; _lr_pairId=eyJ0aW1lc3RhbXAiOjE3NjIyNjk5NDQ0NDksInZlcnNpb24iOiIxLjYuMCIsImVudmVsb3BlIjpbIkF1TUtjemRnbStwNTEwVmFzOWJUNzJUQWlDYjVFOE1pdG1JN3FRMXpnN0xhIl0sImNyZWF0aW9uVGltZXN0YW1wIjoxNzYyMjU1MzY0MzYyfQ%3D%3D; ACC_LL=2|MTAyMzU3NTE0OTI2MTQ5Nzk3Njgz; loginIdentifier=M2NhMmU2ZWNiMmZlMTdhNGFlYzQ3MmY5YzU1OWQ5OGE6OTU3MzZmZDUwYjBjYjM2MGE5ZDEwYjM2ZjMzZjFjNzE5MmZmNTA5YjVmY2YzMmM4ZTVkZmViOTIyNzA1NTY5NDM4YzllMDYzYmI1NDFmNmQ1NzY4MGQ1YmM4MWY2OTMzODFjYzBiMjIwNjY3NDBlMTg3YmZiMzgyZTQ3NTMxY2RjODNkMjRmYTVlMWY2ZTk4N2YyMmRlMmNmYjAxOTA4MDdlYzAzMTI5NTM5Y2Q2ZDk5YWI1ZDRlNTJlZjM2NGJlNzg2MGU3ZGVkNGUwOGFlOGRjMWJlOTk0MmUyMTNmYTJlYzE3NmRhMjczZjUxY2U2ZDgxZTY0MzRkZjVhMGMzZDk4NTE3ZmJhOTcxNTMwZjIyZjI5ZWYyYTdkZjI5MDc3; session_id=SHIELD-WEB:4ecd653b40ab243172236713975dccf4; fp_id=SHIELD-WEB:4ecd653b40ab243172236713975dccf4; __cf_bm=hXYdWk7nwLBEqGulRlVyDo95ccSsfVtLvrtngaW7amM-1762271008-1.0.1.1-OGCLvPOYT571POSLPJB_3xTOHvJVBu8MJ0dgFPKTJwBvkKSXhXOWBxsNOj6zRH8bgqH.rJgSFdjUnqPhwLxTc9jpRTStonMGKd1KhVTJyzQ; pubaccid=bef21590-66ac-42b5-9448-841c569fc989; cf_clearance=rt9SUuzfTGDIAHGv1lzCb6eEvNgxTF4DqxX7Sm2yQ7U-1762271010-1.2.1.1-iIBtsuxK1HP2kF25lZTTtPqCwDXAiKsvxlffEFQzp4Vicnfuv1fwvD0p87GPGn0nD6QViEFSp3Hl9KTjJCM9_.nRU9nmlw9nHdja3AgzxhDbkgzPbwiOeg5m.YOW_GESaSLntLulH7eFrMwzHlej0FyrhlOP9cFYljsxJqZiC6F12IuFe0WNfCtxR36fJReznZKDjtfRNuwbzs4BRGNfyu2WGYvOsH.QGq2Mmg4_dDQ; mf_b837e449-83ee-457f-9ef5-8f976953f2bc=||1762271012481||0||||0|0|14.58469|0|; __gads=ID=55d21a50ef530675:T=1749306758:RT=1762271030:S=ALNI_MZrqDwrst9tsMcWwnhd_X7zx9I5ng; __eoi=ID=5b7d4b642d84c3d6:T=1749306758:RT=1762271030:S=AA-AfjaXnKSHdWFO1TOCCW39Dbhi; nvg83482=164a43e3c0c7b12c48534f817510|0_309; ___iat_ses=43E1DCAFEAA3A4D9; userID=bef21590-66ac-42b5-9448-841c569fc989; is-webview=false; __rtbh.uid=%7B%22eventType%22%3A%22uid%22%2C%22id%22%3A%22bef21590-66ac-42b5-9448-841c569fc989%22%2C%22hash%22%3A%22wBiML0Lv0cEh18cEd5DU%22%2C%22expiryDate%22%3A%222026-11-04T15%3A44%3A13.468Z%22%7D; __rtbh.lid=%7B%22eventType%22%3A%22lid%22%2C%22id%22%3A%2243LnMN33dIrUdp7IuEzf%22%2C%22expiryDate%22%3A%222026-11-04T15%3A44%3A13.469Z%22%7D; userID=bef21590-66ac-42b5-9448-841c569fc989; cto_bundle=U-ltzV9SJTJGSE82QXp1TGF5V0RRdEVIRUxpVTVvZ1F6Z0tid3ZxajhXcExjSm9mTzhCdCUyRk9BdCUyQjg3WmZtTXNIekppTjhlN21QdiUyQlRLNmt2V3FOWDlFek1wa0FUNERkajFlYlBmcnRhZFVyVzNsRkczMDZCZ0h5cEtMQ0olMkJLRiUyQm5WS3RsYWFJM3hjS2VKaGlEdDhmVmVHWURMVXFSNE91ZDZsM3VNeDc3bThZTnY2MUZmZlVvQmtMZ3ZWZ1ZOeUd6TWZMNlZDdXBqMHVnUWxYR2cxTG5icnRkckFaZThNSTJNekhwdUxaZU5EbGdMOHVDZUUlMkJCWUhHOFU0YXdiQUhFRTJYRE8; cto_bidid=Jv4tcF96VHNZbjV0c2RGcjVXS09mYk9ITXZXWHFQcWNuVElpZkpCN0E0SGhXbU83ZnhSTUNSWWYxMXpiaVpidnU2OWI2eDdPM0pzNHFRMkhQY1BmWUJGdnhkT05TREhwNkdLS0hBNjhQZlZNVkw5MCUzRA; ___iat_vis=43E1DCAFEAA3A4D9.07e747e87a9ce7d1926cbaf23edcfec7.1762271057245.b9b6e272c28b97ded9139b52f78286b3.ZBRIRRMABA.11111111.1-0.07e747e87a9ce7d1926cbaf23edcfec7; _ga_50C013M2CC=GS2.1.s1762269943$o58$g1$t1762271061$j42$l0$h0; FCCDCF=%5Bnull%2Cnull%2Cnull%2Cnull%2Cnull%2Cnull%2C%5B%5B32%2C%22%5B%5C%22a7a92b9e-c964-4b75-b8ec-b0e01f5c0264%5C%22%2C%5B1761589985%2C976000000%5D%5D%22%5D%5D%5D; FCNEC=%5B%5B%22AKsRol-9zkPPvMYWUDEZrwO3wM2d1D4Z9ZbZDqzWVv0muY8xBxWI2HQihfqhMeX2cpyc4pMHnl2o1lg74FWPz5g_8C1QkeWOPV1ItERm8VSpU_meBEXk6M8m1ZFml051Q-tPdq7pus9hJsYd8uzL04TJT6tGyQjj2A%3D%3D%22%5D%5D; _dd_s=rum=0&expire=1762271953712; ttcsid_CFL4LE3C77UEUGLEBCA0=1762269943854::jRwvvuFaJbgw7gRLohJM.47.1762271067765.0; ttcsid_C8LQ3HO3N5R2M2PTDC50=1762269943848::ERmBzAz4JHXvCWmuzjp3.47.1762271067844.0; ttcsid=1762269943852::0xpcEYrw0bld4_0HN0n0.47.1762271067845.0`, // coloque todos os cookies aqui
    },
  };
}

function extrairDadosVendedor(html) {
  try {
    const $ = cheerio.load(html);

    let nomeVendedor = null;
    let cpfVendedor = null;
    let localizacao = null;

    // 🔹 Procura qualquer span que tenha "Vendedor:"
    $("span").each((_, el) => {
      const texto = $(el).text().trim();

      if (texto.startsWith("Vendedor:")) {
        nomeVendedor = texto.replace("Vendedor:", "").trim();
      }

      if (texto.startsWith("CPF:")) {
        cpfVendedor = texto.replace("CPF:", "").trim();
      }

      // pega cidade/estado (padrão "- SP", "- RJ" etc)
      if (/ - [A-Z]{2}$/.test(texto)) {
        localizacao = texto;
      }
    });

    return {
      nome: nomeVendedor,
      cpf: cpfVendedor,
      localizacao,
    };
  } catch (error) {
    console.error("Erro ao extrair dados do vendedor:", error);
    return null;
  }
}

// function extrairDadosVendedor(html) {
//   try {
//     const $ = cheerio.load(html);

//     // Procura o texto que contém o nome do vendedor e CPF
//     const vendedorElement = $(
//       'span.olx-text.olx-text--body-small:contains("Vendedor:")',
//     );
//     const loc = $(
//       "#main > div.grid.w-full.grid-cols-1.pt-4.md\:grid-cols-12.md\:gap-4 > div.flex.w-full.flex-col.gap-4.pb-2.md\:col-span-7.lg\:col-span-8 > div:nth-child(1) > div > div > div.hover\:bg-neutral-80.rounded-1.relative.grid.items-center.overflow-visible.border-1.border-solid.border-secondary-100.grid-cols-1 > div > span > span",
//     );

//     const cpfElement = $('span.olx-text.olx-text--body-small:contains("CPF:")');

//     // Extrair o texto completo
//     const vendedorTextoCompleto = vendedorElement.text().trim();
//     const cpfTextoCompleto = cpfElement.text().trim();

//     console.log("Localização extraída:", loc.text().trim());
//     // Extrair apenas o nome do vendedor e CPF
//     const nomeVendedor = vendedorTextoCompleto.replace("Vendedor:", "").trim();
//     const cpfVendedor = cpfTextoCompleto.replace("CPF:", "").trim();

//     return {
//       nome: nomeVendedor,
//       cpf: cpfVendedor,
//     };
//   } catch (error) {
//     console.error("Erro ao extrair dados do vendedor:", error);
//     return null;
//   }
// }

// Nova função para formatar os dados no formato solicitado
function formatarDadosVendedor(dados) {
  if (!dados || !dados.nome || !dados.cpf) return "/Nome3 Indisponível";

  // Extrair componentes do nome
  const partsNome = dados.nome.split(" ");
  const primeiroNome = partsNome[0] || "";

  // Obter as iniciais dos demais nomes
  let iniciais = "";
  for (let i = 1; i < partsNome.length && i <= 4; i++) {
    if (partsNome[i] && partsNome[i].length > 0) {
      iniciais += " " + partsNome[i][0].toUpperCase();
    }
  }

  // Preencher com iniciais padrão se faltarem
  while (iniciais.split(" ").length <= 4) {
    iniciais += " ";
  }

  // Extrair números do CPF (primeiros 6 dígitos ou o que estiver disponível)
  const numerosCpf = dados.cpf.replace(/\D/g, "").substring(0, 6);

  return `/nome2 ${primeiroNome}${iniciais}${numerosCpf}`;
}

// Nova função para buscar informações com ID personalizado
async function buscarInfoComId(listId) {
  try {
    const novaConfig = criarConfig(listId);
    const response = await axios.request(novaConfig);

    // Extrai os dados do vendedor
    const dadosVendedor = extrairDadosVendedor(response.data);

    if (dadosVendedor) {
      const dadosFormatados = formatarDadosVendedor(dadosVendedor);

      const resultDadosOlx = {
        dadosOriginais: dadosVendedor,
        dadosFormatados: dadosFormatados,
        localizacao: dadosVendedor.localizacao || null,
      };
      console.log("Dados extraídos e formatados:", resultDadosOlx);
      return resultDadosOlx;
    } else {
      console.log(`Não foi possível extrair dados do anúncio ${listId}`);
      return null;
    }
  } catch (error) {
    console.error(
      `Erro ao buscar informações para o anúncio ${listId}:`,
      error.message,
    );
    return null;
  }
}

// buscarInfoComId("1482671371");

// Exporta a função para ser usada por outros scripts
module.exports = {
  buscarInfoComId,
  formatarDadosVendedor,
  extrairDadosVendedor,
};

