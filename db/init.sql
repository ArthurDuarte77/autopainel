SET NAMES utf8mb4;
SET time_zone = '-03:00';

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','vendedor','financeiro') NOT NULL DEFAULT 'admin',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  k VARCHAR(80) PRIMARY KEY,
  v TEXT
);

CREATE TABLE sellers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160),
  phone VARCHAR(40),
  commission_pct DECIMAL(5,2) NOT NULL DEFAULT 2.00,
  monthly_goal DECIMAL(12,2) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  brand VARCHAR(60) NOT NULL,
  model VARCHAR(80) NOT NULL,
  version VARCHAR(120),
  body_type ENUM('Hatch','Sedã','SUV','Picape','Utilitário','Moto','Outro') DEFAULT 'Outro',
  year SMALLINT NOT NULL,
  km INT NOT NULL DEFAULT 0,
  plate VARCHAR(10),
  color VARCHAR(40),
  fuel ENUM('Flex','Gasolina','Etanol','Diesel','Híbrido','Elétrico') DEFAULT 'Flex',
  transmission ENUM('Manual','Automático','CVT','Automatizado') DEFAULT 'Automático',
  doors TINYINT DEFAULT 4,
  price DECIMAL(12,2) NOT NULL,
  cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  prep_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('Disponível','Reservado','Em preparação','Vendido') NOT NULL DEFAULT 'Em preparação',
  description TEXT,
  photos JSON,
  sold_price DECIMAL(12,2),
  sold_at DATE,
  seller_id INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plate (plate),
  FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE SET NULL
);

CREATE TABLE publications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  channel VARCHAR(40) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 0,
  external_id VARCHAR(120),
  external_url VARCHAR(500),
  status ENUM('inativo','pendente','publicado','erro') NOT NULL DEFAULT 'inativo',
  last_error TEXT,
  last_sync_at DATETIME,
  UNIQUE KEY uq_vehicle_channel (vehicle_id, channel),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);

CREATE TABLE integration_tokens (
  provider VARCHAR(40) PRIMARY KEY,
  access_token TEXT,
  refresh_token TEXT,
  expires_at DATETIME,
  data JSON,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(40),
  email VARCHAR(160),
  interest VARCHAR(255) NOT NULL,
  brand VARCHAR(60),
  model VARCHAR(80),
  body_type VARCHAR(20),
  fuel VARCHAR(20),
  year_min SMALLINT,
  price_max DECIMAL(12,2),
  stage ENUM('Novo','Em contato','Proposta','Negociação','Fechado','Perdido') NOT NULL DEFAULT 'Novo',
  seller_id INT,
  vehicle_id INT,
  source VARCHAR(40) DEFAULT 'manual',
  notes TEXT,
  crm_refs JSON,
  notified_vehicle_ids JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE SET NULL,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
);

CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  description VARCHAR(255) NOT NULL,
  type ENUM('Receber','Pagar') NOT NULL,
  category ENUM('venda','sinal','comissao','preparacao','anuncio','aluguel','fornecedor','imposto','outros') NOT NULL DEFAULT 'outros',
  amount DECIMAL(12,2) NOT NULL,
  status ENUM('Pago','Pendente') NOT NULL DEFAULT 'Pendente',
  vehicle_id INT,
  seller_id INT,
  document VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE SET NULL,
  KEY idx_date (date)
);

CREATE TABLE events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  time TIME NOT NULL,
  title VARCHAR(255) NOT NULL,
  category ENUM('Cliente','Estoque','Financeiro','Outro') NOT NULL DEFAULT 'Outro',
  lead_id INT,
  vehicle_id INT,
  done TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  KEY idx_date (date)
);

CREATE TABLE appraisals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plate VARCHAR(10),
  model VARCHAR(160),
  year SMALLINT,
  color VARCHAR(40),
  fipe_code VARCHAR(20),
  fipe_price DECIMAL(12,2),
  market_refs JSON,
  market_value DECIMAL(12,2),
  params JSON,
  max_price DECIMAL(12,2),
  est_profit DECIMAL(12,2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sync_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(40) NOT NULL,
  action VARCHAR(60) NOT NULL,
  ok TINYINT(1) NOT NULL,
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_provider (provider)
);

-- ===================== SEED =====================

INSERT INTO settings (k, v) VALUES
 ('monthly_revenue_goal', '600000');

INSERT INTO sellers (id, name, email, phone, commission_pct, monthly_goal) VALUES
 (1, 'Carlos', 'carlos@autopainel.local', '(11) 90000-0001', 2.00, 200000),
 (2, 'Ana',    'ana@autopainel.local',    '(11) 90000-0002', 2.00, 200000),
 (3, 'Bruno',  'bruno@autopainel.local',  '(11) 90000-0003', 2.00, 200000);

INSERT INTO vehicles (id, brand, model, version, body_type, year, km, plate, color, fuel, transmission, price, cost, status, sold_price, sold_at, seller_id, photos) VALUES
 (1, 'Toyota',    'Corolla', 'XEi 2.0',      'Sedã',   2022, 38200, 'RTF-4E21', 'Prata',  'Flex',   'CVT',        128900, 109000, 'Disponível',    NULL,   NULL,         NULL, '["/uploads/corolla.jpg"]'),
 (2, 'Honda',     'HR-V',    'EXL',          'SUV',    2021, 51000, 'QWE-8A33', 'Branco', 'Flex',   'CVT',        119500, 101500, 'Reservado',     NULL,   NULL,         2,    '["/uploads/hr-v.jpg"]'),
 (3, 'Jeep',      'Compass', 'Longitude',    'SUV',    2023, 22400, 'SDF-1B90', 'Preto',  'Flex',   'Automático', 164000, 141000, 'Disponível',    NULL,   NULL,         NULL, '["/uploads/compass.jpg"]'),
 (4, 'VW',        'T-Cross', 'Highline',     'SUV',    2022, 41800, 'PLK-7C12', 'Cinza',  'Flex',   'Automático', 132000, 111000, 'Em preparação', NULL,   NULL,         NULL, '["/uploads/t-cross.jpg"]'),
 (5, 'Chevrolet', 'Onix',    'LTZ',          'Hatch',  2020, 63500, 'MNB-3D45', 'Branco', 'Flex',   'Automático',  72900,  61000, 'Vendido',        72900, '2026-10-09', 1,    '["/uploads/onix.jpg"]'),
 (6, 'Hyundai',   'Creta',   'Platinum',     'SUV',    2023, 18900, 'ZXC-9F67', 'Azul',   'Flex',   'Automático', 149900, 129500, 'Disponível',    NULL,   NULL,         NULL, '["/uploads/creta.jpg"]'),
 (7, 'Fiat',      'Toro',    'Volcano',      'Picape', 2021, 70100, 'GHJ-2K88', 'Vermelho','Diesel','Automático', 139000, 120000, 'Vendido',       139000, '2026-10-12', 1,    '["/uploads/toro.jpg"]'),
 (8, 'Renault',   'Kwid',    'Zen',          'Hatch',  2022, 29800, 'TYU-5L03', 'Branco', 'Flex',   'Manual',      54900,  46000, 'Disponível',    NULL,   NULL,         NULL, '["/uploads/kwid.jpg"]');
-- T-Cross: R$ 3.200 de funilaria em prep_cost
UPDATE vehicles SET prep_cost = 3200 WHERE id = 4;

INSERT INTO publications (vehicle_id, channel, active, status) VALUES
 (1, 'olx', 1, 'pendente'), (1, 'mercadolivre', 1, 'pendente'), (1, 'site', 1, 'pendente'),
 (2, 'olx', 1, 'pendente'), (2, 'site', 1, 'pendente'),
 (3, 'mercadolivre', 1, 'pendente'), (3, 'site', 1, 'pendente'),
 (6, 'olx', 1, 'pendente'), (6, 'mercadolivre', 1, 'pendente'), (6, 'site', 1, 'pendente'),
 (8, 'olx', 1, 'pendente');

INSERT INTO leads (name, phone, email, interest, brand, model, body_type, fuel, year_min, price_max, stage, seller_id, vehicle_id, source) VALUES
 ('Mariana Souza',  '(11) 98888-1001', 'mariana@example.com',  'SUV compacto 2023+ até R$ 150 mil', NULL,     NULL,      'SUV',    NULL,     2023, 150000, 'Novo',       1, NULL, 'site'),
 ('Patrícia Rocha', '(11) 98888-1002', 'patricia@example.com', 'Hatch econômico',                  NULL,     NULL,      'Hatch',  NULL,     NULL,  60000, 'Novo',       2, NULL, 'olx'),
 ('João Pereira',   '(11) 98888-1003', 'joao@example.com',     'Toyota Corolla 2021+',             'Toyota', 'Corolla', NULL,     NULL,     2021, NULL,   'Em contato', 2, NULL, 'mercadolivre'),
 ('Lucas Martins',  '(11) 98888-1004', 'lucas@example.com',    'Honda Civic 2020+',                'Honda',  'Civic',   NULL,     NULL,     2020, NULL,   'Em contato', 3, NULL, 'manual'),
 ('Fernanda Lima',  '(11) 98888-1005', 'fernanda@example.com', 'Picape diesel',                    NULL,     NULL,      'Picape', 'Diesel', NULL, NULL,   'Proposta',   1, NULL, 'manual'),
 ('Ricardo Alves',  '(11) 98888-1006', 'ricardo@example.com',  'Jeep Compass',                     'Jeep',   'Compass', NULL,     NULL,     NULL, NULL,   'Negociação', 3, NULL, 'site'),
 ('Gabriela Costa', '(11) 98888-1007', 'gabriela@example.com', 'Fiat Toro',                        'Fiat',   'Toro',    NULL,     NULL,     NULL, NULL,   'Fechado',    1, 7,    'manual');

-- Histórico de faturamento (meses anteriores consolidados)
INSERT INTO transactions (date, description, type, category, amount, status) VALUES
 ('2026-05-31', 'Vendas consolidadas — maio',     'Receber', 'venda', 410000, 'Pago'),
 ('2026-06-30', 'Vendas consolidadas — junho',    'Receber', 'venda', 465000, 'Pago'),
 ('2026-07-31', 'Vendas consolidadas — julho',    'Receber', 'venda', 398000, 'Pago'),
 ('2026-08-31', 'Vendas consolidadas — agosto',   'Receber', 'venda', 520000, 'Pago'),
 ('2026-09-30', 'Vendas consolidadas — setembro', 'Receber', 'venda', 588000, 'Pago');

INSERT INTO transactions (date, description, type, category, amount, status, vehicle_id, seller_id) VALUES
 ('2026-10-12', 'Venda Fiat Toro Volcano',          'Receber', 'venda',      139000, 'Pago',     7,    1),
 ('2026-10-11', 'Funilaria VW T-Cross',             'Pagar',   'preparacao',   3200, 'Pendente', 4,    NULL),
 ('2026-10-10', 'Comissão Carlos — Onix',           'Pagar',   'comissao',     1450, 'Pago',     5,    1),
 ('2026-10-09', 'Venda Chevrolet Onix LTZ',         'Receber', 'venda',       72900, 'Pago',     5,    1),
 ('2026-10-08', 'Anúncios OLX (mensal)',            'Pagar',   'anuncio',       890, 'Pago',     NULL, NULL),
 ('2026-10-15', 'Aluguel do pátio',                 'Pagar',   'aluguel',      8500, 'Pendente', NULL, NULL),
 ('2026-10-18', 'Sinal Honda HR-V',                 'Receber', 'sinal',       10000, 'Pendente', 2,    2);

INSERT INTO events (date, time, title, category, lead_id, vehicle_id) VALUES
 (CURDATE(), '09:00', 'Retornar ligação — João Pereira',            'Cliente',    3,    NULL),
 (CURDATE(), '10:30', 'Vistoria Jeep Compass (entrada)',            'Estoque',    NULL, 3),
 (CURDATE(), '14:00', 'Test drive Hyundai Creta — Mariana',         'Cliente',    1,    6),
 (CURDATE(), '16:00', 'Enviar documentos de vendas ao contador',    'Financeiro', NULL, NULL),
 (CURDATE(), '17:30', 'Pagar fornecedor de funilaria',              'Financeiro', NULL, NULL);
