/**
 * Catálogo FICTÍCIO da empresa de demonstração "Elétrica Central".
 *
 * Fabricantes, códigos e preços são inventados para a demonstração — não correspondem
 * a marcas, produtos ou valores reais. A geração é determinística: executar o seed
 * várias vezes produz sempre o mesmo catálogo.
 */

export interface DemoProduct {
  sku: string;
  description: string;
  manufacturer: string;
  manufacturerCode: string;
  category: string;
  unit: string;
  /** Preço base de catálogo; `null` = sem preço cadastrado (exige preço manual na cotação). */
  price: number | null;
  synonyms: string[];
  /** Códigos alternativos (equivalências de outros fabricantes fictícios). */
  alternativeCodes: Array<{ value: string; manufacturer: string }>;
}

/** Fabricantes fictícios. */
export const DEMO_MANUFACTURERS = {
  protecao: "Zentrik",
  comando: "Amperis",
  cabos: "Kabrax",
  dutos: "Tubovia",
  iluminacao: "Lumivar",
  automacao: "Induvia",
  conexoes: "Bornex",
  quadros: "Tekvolt",
} as const;

const POLE_WORDS: Record<number, string> = { 1: "Monopolar", 2: "Bipolar", 3: "Tripolar", 4: "Tetrapolar" };

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function pad(value: number | string, length = 3): string {
  return String(value).padStart(length, "0");
}

function decimal(value: number): string {
  return String(value).replace(".", ",");
}

export function buildDemoCatalog(): DemoProduct[] {
  const products: DemoProduct[] = [];
  const add = (product: Omit<DemoProduct, "synonyms" | "alternativeCodes"> & Partial<Pick<DemoProduct, "synonyms" | "alternativeCodes">>) => {
    products.push({ synonyms: [], alternativeCodes: [], ...product });
  };
  const M = DEMO_MANUFACTURERS;

  // ── Proteção: minidisjuntores DIN ─────────────────────────────────────────
  for (const poles of [1, 2, 3]) {
    for (const current of [10, 16, 20, 25, 32, 40, 50, 63]) {
      add({
        sku: `DJ-${poles}P-${pad(current)}-C`,
        description: `Disjuntor DIN ${POLE_WORDS[poles]} ${current}A Curva C 3kA`,
        manufacturer: M.protecao,
        manufacturerCode: `ZTK-M${poles}C${current}`,
        category: "Proteção",
        unit: "UN",
        price: money(9.9 + poles * 11.5 + current * 0.42),
        synonyms: [`minidisjuntor ${poles}P ${current}A curva C`, `disjuntor termomagnético ${POLE_WORDS[poles]?.toLowerCase()} ${current}A`],
        alternativeCodes: poles === 3 && current === 32 ? [{ value: "AMP-D3C32", manufacturer: M.comando }] : [],
      });
    }
  }
  for (const current of [10, 16, 20]) {
    add({
      sku: `DJ-1P-${pad(current)}-B`,
      description: `Disjuntor DIN Monopolar ${current}A Curva B 3kA`,
      manufacturer: M.protecao,
      manufacturerCode: `ZTK-M1B${current}`,
      category: "Proteção",
      unit: "UN",
      price: money(22.4 + current * 0.42),
      synonyms: [`minidisjuntor 1P ${current}A curva B`],
    });
  }

  // ── Proteção: IDR, DPS e caixa moldada ────────────────────────────────────
  for (const [poles, currents] of [
    [2, [25, 40, 63]],
    [4, [40, 63]],
  ] as Array<[number, number[]]>) {
    for (const current of currents) {
      add({
        sku: `IDR-${poles}P-${pad(current)}-30`,
        description: `Interruptor Diferencial Residual IDR ${POLE_WORDS[poles]} ${current}A 30mA`,
        manufacturer: M.protecao,
        manufacturerCode: `ZTK-R${poles}${pad(current, 2)}30`,
        category: "Proteção",
        unit: "UN",
        price: money(118 + poles * 34 + current * 1.9),
        synonyms: [`DR ${poles}P ${current}A 30mA`, `interruptor DR ${POLE_WORDS[poles]?.toLowerCase()} ${current}A`],
      });
    }
  }
  for (const ka of [20, 45]) {
    add({
      sku: `DPS-275-${ka}`,
      description: `DPS Dispositivo de Proteção contra Surtos 275V ${ka}kA Monopolar`,
      manufacturer: M.protecao,
      manufacturerCode: `ZTK-S275${ka}`,
      category: "Proteção",
      unit: "UN",
      price: money(42 + ka * 1.35),
      synonyms: [`protetor de surto ${ka}kA`, `DPS classe II ${ka}kA 275V`],
    });
  }
  for (const current of [100, 125, 160]) {
    add({
      sku: `DCM-3P-${current}`,
      description: `Disjuntor Caixa Moldada Tripolar ${current}A 25kA`,
      manufacturer: M.protecao,
      manufacturerCode: `ZTK-X3${current}`,
      category: "Proteção",
      unit: "UN",
      price: money(385 + current * 2.6),
      synonyms: [`disjuntor em caixa moldada 3P ${current}A`],
    });
  }

  // ── Comando: contatores, relés térmicos, botoeiras e sinaleiros ───────────
  for (const current of [9, 12, 18, 25, 32]) {
    for (const coil of [24, 220]) {
      add({
        sku: `CT-${pad(current, 2)}-${coil}`,
        description: `Contator Tripolar ${current}A Bobina ${coil}Vca 1NA`,
        manufacturer: M.comando,
        manufacturerCode: `AMP-K${pad(current, 2)}${coil === 24 ? "B" : "M"}`,
        category: "Comando",
        unit: "UN",
        price: money(72 + current * 4.1),
        synonyms: [`contactor ${current}A bobina ${coil}V`, `chave contatora ${current}A ${coil}V`],
      });
    }
  }
  for (const range of ["4-6", "7-10", "9-13", "12-18", "17-25"]) {
    add({
      sku: `RT-${range.replace("-", "")}`,
      description: `Relé Térmico de Sobrecarga ${range}A`,
      manufacturer: M.comando,
      manufacturerCode: `AMP-T${range.replace("-", "")}`,
      category: "Comando",
      unit: "UN",
      price: money(96 + Number(range.split("-")[1]) * 1.8),
      synonyms: [`relé de sobrecarga ${range}A`, `relé bimetálico ${range}A`],
    });
  }
  add({ sku: "BT-22-VD", description: "Botão de Comando 22mm Verde 1NA", manufacturer: M.comando, manufacturerCode: "AMP-B22G", category: "Comando", unit: "UN", price: 18.9, synonyms: ["botoeira verde 22mm", "botão pulsador verde"] });
  add({ sku: "BT-22-VM", description: "Botão de Comando 22mm Vermelho 1NF", manufacturer: M.comando, manufacturerCode: "AMP-B22R", category: "Comando", unit: "UN", price: 18.9, synonyms: ["botoeira vermelha 22mm", "botão pulsador vermelho"] });
  add({ sku: "BT-22-EM", description: "Botão de Emergência Cogumelo 22mm Vermelho 1NF com Trava", manufacturer: M.comando, manufacturerCode: "AMP-E22R", category: "Comando", unit: "UN", price: 46.5, synonyms: ["botão soco emergência", "botoeira de emergência tipo cogumelo"] });
  for (const [color, code] of [["Verde", "G"], ["Vermelho", "R"], ["Amarelo", "Y"]] as const) {
    for (const voltage of [24, 220]) {
      add({
        sku: `SN-22-${code}-${voltage}`,
        description: `Sinaleiro LED 22mm ${color} ${voltage}V`,
        manufacturer: M.comando,
        manufacturerCode: `AMP-L22${code}${voltage === 24 ? "B" : "M"}`,
        category: "Comando",
        unit: "UN",
        price: 14.7,
        synonyms: [`sinalizador LED ${color.toLowerCase()} 22mm ${voltage}V`, `olho de boi LED ${color.toLowerCase()}`],
      });
    }
  }

  // ── Cabos ────────────────────────────────────────────────────────────────
  const cablePrice: Record<string, number> = { "1.5": 1.42, "2.5": 2.28, "4": 3.74, "6": 5.61, "10": 9.87, "16": 15.4 };
  const colorCodes: Record<string, string> = { Preto: "PT", Azul: "AZ", Vermelho: "VM", Verde: "VD" };
  for (const section of [1.5, 2.5, 4, 6, 10]) {
    for (const color of ["Preto", "Azul", "Vermelho", "Verde"]) {
      add({
        sku: `CB-${String(section).replace(".", "")}-${colorCodes[color]}`,
        description: `Cabo Flexível ${decimal(section)}mm² 750V ${color}`,
        manufacturer: M.cabos,
        manufacturerCode: `KBX-F${String(section).replace(".", "")}${colorCodes[color]}`,
        category: "Cabos",
        unit: "M",
        price: cablePrice[String(section)] ?? null,
        synonyms: [`fio flexível ${decimal(section)}mm ${color.toLowerCase()}`, `cabinho ${decimal(section)} ${color.toLowerCase()}`],
      });
    }
  }
  add({ sku: "CB-16-PT", description: "Cabo Flexível 16mm² 750V Preto", manufacturer: M.cabos, manufacturerCode: "KBX-F16PT", category: "Cabos", unit: "M", price: cablePrice["16"] ?? null, synonyms: ["fio flexível 16mm preto"] });
  for (const color of ["Preto", "Azul", "Vermelho"]) {
    add({
      sku: `CB-25-${colorCodes[color]}-RL`,
      description: `Cabo Flexível 2,5mm² 750V ${color} Rolo 100m`,
      manufacturer: M.cabos,
      manufacturerCode: `KBX-F25${colorCodes[color]}R`,
      category: "Cabos",
      unit: "RL",
      price: 214.9,
      synonyms: [`rolo de cabo flexível 2,5mm ${color.toLowerCase()} 100 metros`],
    });
  }
  for (const section of [1.5, 2.5]) {
    add({
      sku: `PP-3X${String(section).replace(".", "")}`,
      description: `Cabo PP 3x${decimal(section)}mm² 500V Preto`,
      manufacturer: M.cabos,
      manufacturerCode: `KBX-P3${String(section).replace(".", "")}`,
      category: "Cabos",
      unit: "M",
      price: money(section * 3.9 + 1.2),
      synonyms: [`cabo PP 3 vias ${decimal(section)}mm`, `cordão paralelo 3x${decimal(section)}`],
    });
  }

  // ── Eletrodutos e canaletas ───────────────────────────────────────────────
  const inchCode: Record<string, string> = { '1/2"': "12", '3/4"': "34", '1"': "10" };
  for (const [size, price] of [['1/2"', 9.8], ['3/4"', 13.4], ['1"', 19.9]] as Array<[string, number]>) {
    add({ sku: `EL-PVC-${inchCode[size]}`, description: `Eletroduto PVC Rígido Roscável ${size} Barra 3m`, manufacturer: M.dutos, manufacturerCode: `TBV-R${inchCode[size]}`, category: "Eletrodutos", unit: "BR", price, synonyms: [`conduíte rígido PVC ${size}`, `eletroduto roscável ${size} vara 3 metros`] });
    add({ sku: `LV-PVC-${inchCode[size]}`, description: `Luva para Eletroduto PVC Roscável ${size}`, manufacturer: M.dutos, manufacturerCode: `TBV-L${inchCode[size]}`, category: "Eletrodutos", unit: "UN", price: money(price * 0.14), synonyms: [`luva PVC ${size} roscável`] });
  }
  for (const [size, price] of [['3/4"', 3.6], ['1"', 5.2]] as Array<[string, number]>) {
    add({ sku: `CV-PVC-${inchCode[size]}`, description: `Curva 90 Graus para Eletroduto PVC Roscável ${size}`, manufacturer: M.dutos, manufacturerCode: `TBV-C${inchCode[size]}`, category: "Eletrodutos", unit: "UN", price, synonyms: [`curva 90 PVC ${size}`, `cotovelo eletroduto ${size}`] });
    add({ sku: `EL-GALV-${inchCode[size]}`, description: `Eletroduto Aço Galvanizado ${size} Barra 3m`, manufacturer: M.dutos, manufacturerCode: `TBV-G${inchCode[size]}`, category: "Eletrodutos", unit: "BR", price: money(price * 9.4), synonyms: [`conduíte galvanizado ${size}`, `eletroduto metálico ${size} vara 3m`] });
  }
  for (const [diameter, price] of [[20, 62.9], [25, 79.9], [32, 118.5]] as Array<[number, number]>) {
    add({ sku: `EL-COR-${diameter}`, description: `Eletroduto Corrugado Flexível PVC Amarelo ${diameter}mm Rolo 50m`, manufacturer: M.dutos, manufacturerCode: `TBV-F${diameter}`, category: "Eletrodutos", unit: "RL", price, synonyms: [`conduíte corrugado amarelo ${diameter}mm`, `mangueira corrugada ${diameter}mm rolo 50m`] });
  }
  for (const [size, price] of [["20x10", 8.9], ["30x30", 19.7], ["50x50", 41.2]] as Array<[string, number]>) {
    add({ sku: `CN-${size.replace("x", "")}`, description: `Canaleta PVC ${size}mm Branca Barra 2m`, manufacturer: M.dutos, manufacturerCode: `TBV-N${size.replace("x", "")}`, category: "Canaletas", unit: "BR", price, synonyms: [`canaleta de sobrepor ${size}`, `canaleta plástica ${size}mm`] });
  }
  for (const [size, price] of [["30x50", 27.4], ["50x50", 38.6]] as Array<[string, number]>) {
    add({ sku: `CN-REC-${size.replace("x", "")}`, description: `Canaleta Recortada para Painel ${size}mm Cinza Barra 2m`, manufacturer: M.dutos, manufacturerCode: `TBV-P${size.replace("x", "")}`, category: "Canaletas", unit: "BR", price, synonyms: [`canaleta ventilada ${size}`, `canaleta aberta de painel ${size}mm`] });
  }

  // ── Tomadas, plugues e interruptores ──────────────────────────────────────
  for (const [current, price] of [[10, 9.4], [20, 12.8]] as Array<[number, number]>) {
    add({ sku: `TM-2PT-${current}`, description: `Tomada 2P+T ${current}A 250V Branca`, manufacturer: M.conexoes, manufacturerCode: `BNX-T${current}`, category: "Tomadas e Interruptores", unit: "UN", price, synonyms: [`tomada padrão novo ${current}A`, `módulo tomada ${current}A branca`] });
    add({ sku: `PL-2PT-${current}`, description: `Plugue Macho 2P+T ${current}A 250V`, manufacturer: M.conexoes, manufacturerCode: `BNX-P${current}`, category: "Tomadas e Interruptores", unit: "UN", price: money(price * 0.72), synonyms: [`plug macho ${current}A`, `pino macho 2P+T ${current}A`] });
  }
  add({ sku: "IT-SIMP-10", description: "Interruptor Simples 10A 250V Branco", manufacturer: M.conexoes, manufacturerCode: "BNX-I10", category: "Tomadas e Interruptores", unit: "UN", price: 8.6, synonyms: ["interruptor 1 tecla 10A", "interruptor de luz simples"] });
  add({ sku: "CJ-4X2-TD10", description: "Conjunto 4x2 Tomada Dupla 2P+T 10A 250V Branco", manufacturer: M.conexoes, manufacturerCode: "BNX-C2T10", category: "Tomadas e Interruptores", unit: "UN", price: 24.9, synonyms: ["tomada dupla 10A com placa 4x2"] });
  for (const [current, price] of [[16, 38.5], [32, 61.9]] as Array<[number, number]>) {
    add({ sku: `PI-3PT-${current}`, description: `Plugue Industrial 3P+T ${current}A 380V IP44`, manufacturer: M.conexoes, manufacturerCode: `BNX-N3${current}`, category: "Tomadas e Interruptores", unit: "UN", price, synonyms: [`plug industrial ${current}A 3P+T vermelho`, `plugue industrial vermelho ${current}A 380V`] });
    add({ sku: `TI-3PT-${current}`, description: `Tomada Industrial de Sobrepor 3P+T ${current}A 380V IP44`, manufacturer: M.conexoes, manufacturerCode: `BNX-S3${current}`, category: "Tomadas e Interruptores", unit: "UN", price: money(price * 1.35), synonyms: [`tomada industrial ${current}A 3P+T sobrepor`] });
  }

  // ── Iluminação ───────────────────────────────────────────────────────────
  for (const [power, price] of [[9, 7.9], [12, 10.4], [15, 13.9]] as Array<[number, number]>) {
    for (const kelvin of [6500, 3000]) {
      add({ sku: `LP-${pad(power, 2)}-${kelvin / 100}`, description: `Lâmpada LED Bulbo ${power}W Bivolt ${kelvin}K E27`, manufacturer: M.iluminacao, manufacturerCode: `LMV-B${power}${kelvin === 6500 ? "F" : "Q"}`, category: "Iluminação", unit: "UN", price, synonyms: [`lâmpada bulbo LED ${power}W ${kelvin === 6500 ? "branca fria" : "branca quente"}`] });
    }
  }
  for (const [power, price] of [[30, 39.9], [50, 58.7], [100, 104.9], [200, 219.0]] as Array<[number, number]>) {
    add({ sku: `RF-${pad(power)}`, description: `Refletor LED ${power}W Bivolt 6500K IP65`, manufacturer: M.iluminacao, manufacturerCode: `LMV-R${power}`, category: "Iluminação", unit: "UN", price, synonyms: [`holofote LED ${power}W`, `projetor LED ${power}W IP65`] });
  }
  add({ sku: "LM-TUB-18", description: "Luminária LED Tubular de Sobrepor 18W Bivolt 6500K 1,2m", manufacturer: M.iluminacao, manufacturerCode: "LMV-T18", category: "Iluminação", unit: "UN", price: 46.8, synonyms: ["luminária tubular LED 120cm", "calha LED 18W"] });
  add({ sku: "PN-EMB-24", description: "Painel LED de Embutir Quadrado 24W Bivolt 4000K", manufacturer: M.iluminacao, manufacturerCode: "LMV-P24", category: "Iluminação", unit: "UN", price: 52.3, synonyms: ["plafon LED embutir 24W", "painel LED quadrado embutir"] });

  // ── Automação ────────────────────────────────────────────────────────────
  for (const [cv, price] of [[1, 1189], [2, 1479], [3, 1865]] as Array<[number, number]>) {
    add({ sku: `IF-${cv}CV-220`, description: `Inversor de Frequência ${cv}CV 220V Entrada Monofásica`, manufacturer: M.automacao, manufacturerCode: `IDV-V${cv}M2`, category: "Automação", unit: "UN", price, synonyms: [`inversor ${cv}CV 220V mono`, `conversor de frequência ${cv}CV`] });
  }
  for (const [cv, price] of [[3, 2140], [5, 2790]] as Array<[number, number]>) {
    add({ sku: `IF-${cv}CV-380`, description: `Inversor de Frequência ${cv}CV 380V Trifásico`, manufacturer: M.automacao, manufacturerCode: `IDV-V${cv}T4`, category: "Automação", unit: "UN", price, synonyms: [`inversor ${cv}CV 380V tri`] });
  }
  for (const current of [16, 30]) {
    add({ sku: `SS-${current}`, description: `Soft-Starter ${current}A 220/380V`, manufacturer: M.automacao, manufacturerCode: `IDV-S${current}`, category: "Automação", unit: "UN", price: null, synonyms: [`chave de partida suave ${current}A`, `soft starter ${current}A`] });
  }
  for (const thread of [12, 18, 30]) {
    for (const output of ["PNP", "NPN"]) {
      add({ sku: `SI-M${thread}-${output}`, description: `Sensor Indutivo M${thread} ${output} NA 24Vcc`, manufacturer: M.automacao, manufacturerCode: `IDV-I${thread}${output[0]}`, category: "Automação", unit: "UN", price: money(58 + thread * 1.9), synonyms: [`sensor de proximidade indutivo M${thread} ${output}`] });
    }
  }
  add({ sku: "SF-M18-PNP", description: "Sensor Fotoelétrico Difuso M18 PNP NA 24Vcc", manufacturer: M.automacao, manufacturerCode: "IDV-O18P", category: "Automação", unit: "UN", price: 142.0, synonyms: ["sensor óptico difuso M18 PNP", "fotocélula M18 24V"] });
  for (const [current, watts, price] of [[2.5, 60, 96.5], [5, 120, 148.9], [10, 240, 259.0]] as Array<[number, number, number]>) {
    add({ sku: `FT-24-${String(current).replace(".", "")}`, description: `Fonte Chaveada 24Vcc ${decimal(current)}A ${watts}W Trilho DIN`, manufacturer: M.automacao, manufacturerCode: `IDV-F24${watts}`, category: "Automação", unit: "UN", price, synonyms: [`fonte de alimentação 24V ${decimal(current)}A`, `fonte industrial 24Vcc ${watts}W`] });
  }
  add({ sku: "CLP-14-10", description: "CLP Compacto 14 Entradas 10 Saídas a Relé 24Vcc", manufacturer: M.automacao, manufacturerCode: "IDV-C1410", category: "Automação", unit: "UN", price: null, synonyms: ["controlador lógico programável 14E 10S", "PLC compacto 24Vcc"] });
  add({ sku: "TP-MULTI", description: "Temporizador Digital Multifunção 24-240V", manufacturer: M.automacao, manufacturerCode: "IDV-T240", category: "Automação", unit: "UN", price: 118.4, synonyms: ["relé temporizador multifunção", "timer digital"] });
  add({ sku: "RI-24-1R", description: "Relé de Interface 24Vcc 1 Contato Reversível", manufacturer: M.automacao, manufacturerCode: "IDV-R241", category: "Automação", unit: "UN", price: 27.9, synonyms: ["relé acoplador 24Vcc", "relé de interface slim"] });

  // ── Conexões e acessórios ─────────────────────────────────────────────────
  for (const [size, price] of [["9", 2.1], ["11", 2.6], ["13,5", 3.2], ["16", 4.1], ["21", 5.9]] as Array<[string, number]>) {
    add({ sku: `PC-PG${size.replace(",", "")}`, description: `Prensa-Cabo Nylon PG ${size} Cinza`, manufacturer: M.conexoes, manufacturerCode: `BNX-G${size.replace(",", "")}`, category: "Conexões", unit: "UN", price, synonyms: [`prensa cabos PG${size}`, `prensa cabo plástico PG ${size}`] });
  }
  add({ sku: "PC-M20", description: "Prensa-Cabo Nylon M20 Rosca Métrica Cinza", manufacturer: M.conexoes, manufacturerCode: "BNX-GM20", category: "Conexões", unit: "UN", price: 3.4, synonyms: ["prensa cabos M20"] });
  for (const [section, color, price] of [[1.5, "Preto", 14.9], [2.5, "Azul", 17.9], [4, "Cinza", 22.4], [6, "Amarelo", 28.9]] as Array<[number, string, number]>) {
    add({ sku: `TI-${String(section).replace(".", "")}`, description: `Terminal Ilhós Tubular ${decimal(section)}mm² ${color} Pacote 100 unidades`, manufacturer: M.conexoes, manufacturerCode: `BNX-H${String(section).replace(".", "")}`, category: "Conexões", unit: "PCT", price, synonyms: [`terminal tubular ilhós ${decimal(section)}mm`, `ponteira ilhós ${decimal(section)}`] });
  }
  for (const [section, bolt, price] of [[2.5, "M5", 0.62], [6, "M6", 1.14], [10, "M8", 1.96]] as Array<[number, string, number]>) {
    add({ sku: `TO-${String(section).replace(".", "")}-${bolt}`, description: `Terminal Olhal Pré-Isolado ${decimal(section)}mm² Furo ${bolt}`, manufacturer: M.conexoes, manufacturerCode: `BNX-O${String(section).replace(".", "")}${bolt}`, category: "Conexões", unit: "UN", price, synonyms: [`terminal anel ${decimal(section)}mm ${bolt}`] });
  }
  for (const [size, price] of [["100x2,5", 4.9], ["200x3,6", 11.8], ["300x4,8", 23.9]] as Array<[string, number]>) {
    add({ sku: `AB-${size.split("x")[0]}`, description: `Abraçadeira Nylon ${size}mm Preta Pacote 100 unidades`, manufacturer: M.conexoes, manufacturerCode: `BNX-A${size.split("x")[0]}`, category: "Acessórios", unit: "PCT", price, synonyms: [`enforca-gato ${size.split("x")[0]}mm`, `cinta plástica ${size.split("x")[0]}mm preta`] });
  }
  add({ sku: "FI-19-20", description: "Fita Isolante Preta 19mm x 20m", manufacturer: M.conexoes, manufacturerCode: "BNX-F1920", category: "Acessórios", unit: "UN", price: 7.9, synonyms: ["fita isolante 20 metros"] });
  add({ sku: "FI-19-10", description: "Fita Isolante Preta 19mm x 10m", manufacturer: M.conexoes, manufacturerCode: "BNX-F1910", category: "Acessórios", unit: "UN", price: 4.6, synonyms: ["fita isolante 10 metros"] });
  add({ sku: "FA-19-10", description: "Fita de Autofusão 19mm x 10m", manufacturer: M.conexoes, manufacturerCode: "BNX-U1910", category: "Acessórios", unit: "UN", price: 21.5, synonyms: ["fita autofusão", "fita de alta tensão autofusão"] });
  for (const [section, price] of [[2.5, 3.9], [4, 4.8], [6, 6.3], [10, 9.1]] as Array<[number, number]>) {
    add({ sku: `BN-${String(section).replace(".", "")}`, description: `Borne de Passagem para Trilho DIN ${decimal(section)}mm² Cinza`, manufacturer: M.conexoes, manufacturerCode: `BNX-K${String(section).replace(".", "")}`, category: "Conexões", unit: "UN", price, synonyms: [`borne de passagem tipo parafuso ${decimal(section)}mm`, `conector de passagem ${decimal(section)}mm trilho`] });
  }
  add({ sku: "TR-DIN-2M", description: "Trilho DIN 35mm Aço Galvanizado Perfurado Barra 2m", manufacturer: M.quadros, manufacturerCode: "TKV-D352", category: "Acessórios", unit: "BR", price: 26.9, synonyms: ["trilho DIN TS35 2 metros", "perfil DIN 35mm"] });
  for (const [phases, word, price] of [[1, "Monofásico", 21.9], [2, "Bifásico", 36.4], [3, "Trifásico", 52.8]] as Array<[number, string, number]>) {
    add({ sku: `BP-${phases}F-63`, description: `Barramento Pente ${word} 63A 1m`, manufacturer: M.quadros, manufacturerCode: `TKV-P${phases}63`, category: "Acessórios", unit: "UN", price, synonyms: [`barramento tipo pente ${word.toLowerCase()} 63A`] });
  }

  // ── Quadros, caixas e aterramento ─────────────────────────────────────────
  for (const [modules, price] of [[12, 89.9], [24, 149.9], [36, 229.0]] as Array<[number, number]>) {
    add({ sku: `QD-EMB-${modules}`, description: `Quadro de Distribuição de Embutir ${modules} Disjuntores DIN`, manufacturer: M.quadros, manufacturerCode: `TKV-Q${modules}E`, category: "Quadros", unit: "UN", price, synonyms: [`centrinho de distribuição ${modules} disjuntores`, `QDC embutir ${modules} módulos`] });
  }
  for (const [size, price] of [["40x30x20", 312], ["60x40x20", 468], ["80x60x25", 789]] as Array<[string, number]>) {
    add({ sku: `QC-${size.replace(/x/g, "")}`, description: `Quadro de Comando Aço ${size}cm IP54 com Placa de Montagem`, manufacturer: M.quadros, manufacturerCode: `TKV-C${size.split("x")[0]}${size.split("x")[1]}`, category: "Quadros", unit: "UN", price, synonyms: [`painel de comando ${size}`, `caixa de montagem metálica ${size}cm`] });
  }
  add({ sku: "CX-4X2", description: "Caixa de Passagem de Embutir PVC 4x2", manufacturer: M.quadros, manufacturerCode: "TKV-X42", category: "Quadros", unit: "UN", price: 2.3, synonyms: ["caixinha de luz 4x2", "caixa de embutir 4x2 amarela"] });
  add({ sku: "CX-4X4", description: "Caixa de Passagem de Embutir PVC 4x4", manufacturer: M.quadros, manufacturerCode: "TKV-X44", category: "Quadros", unit: "UN", price: 4.1, synonyms: ["caixinha de luz 4x4", "caixa de embutir 4x4"] });
  add({ sku: "CD-AL-34", description: 'Condulete de Alumínio 3/4" com Tampa', manufacturer: M.quadros, manufacturerCode: "TKV-U34", category: "Quadros", unit: "UN", price: 17.6, synonyms: ['condulete múltiplo 3/4"', "caixa condulete alumínio"] });
  add({ sku: "HT-58-24", description: 'Haste de Aterramento Cobreada 5/8" x 2,40m', manufacturer: M.quadros, manufacturerCode: "TKV-H5824", category: "Aterramento", unit: "UN", price: 54.9, synonyms: ["haste terra cobreada 2,4m", "haste de cobre para aterramento 5/8"] });
  add({ sku: "CN-HT-58", description: 'Conector para Haste de Aterramento 5/8" Latão', manufacturer: M.quadros, manufacturerCode: "TKV-G58", category: "Aterramento", unit: "UN", price: 8.4, synonyms: ['grampo de aterramento 5/8"', "conector haste terra"] });

  return products;
}

/** Catálogo reduzido da segunda empresa de demonstração (usada para ilustrar o isolamento entre organizações). */
export function buildSecondaryCatalog(): DemoProduct[] {
  return buildDemoCatalog()
    .filter((product) => ["Proteção", "Cabos"].includes(product.category))
    .filter((_, index) => index % 4 === 0)
    .map((product) => ({ ...product, sku: `VS-${product.sku}`, price: product.price ? money(product.price * 1.07) : null }));
}
