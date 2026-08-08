const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Resend } = require('resend');
const bcrypt = require('bcrypt');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Permite servir os arquivos estáticos da raiz
app.use(express.static(__dirname));

const MONGO_URL = process.env.MONGO_URL;

if (MONGO_URL) {
    mongoose.connect(MONGO_URL)
        .then(() => console.log('Conectado ao MongoDB Atlas com sucesso!'))
        .catch(err => console.error('Erro ao conectar ao MongoDB:', err));
} else {
    console.warn('Aviso: MONGO_URL não definida nas variáveis de ambiente.');
}

const resend = new Resend(process.env.RESEND_API_KEY);

const configSchema = new mongoose.Schema({
    limite_pedidos: { type: String, default: 'ilimitado' },
    show_liberado: { type: String, default: 'nao' },
    subtitulo: { type: String, default: '' },
    event_id: { type: String, default: () => Date.now().toString() },
    acessos_show: { type: Number, default: 0 },
    visitantes_unicos: { type: [String], default: [] },
    show_inicio_ts: { type: Number, default: null }
});

const musicaSchema = new mongoose.Schema({
    id: { type: String, required: true },
    titulo: { type: String, required: true },
    artista: { type: String, required: true },
    genero: { type: String, default: '' },
    origem: { type: String, default: 'Nacional' }
});

const pedidoSchema = new mongoose.Schema({
    pedido_id: { type: String, required: true },
    titulo: { type: String, required: true },
    artista: { type: String, required: true },
    dedicatoria: { type: String, default: '' },
    status: { type: String, default: 'pendente' },
    tipo_pedido: { type: String, default: 'normal' },
    votos: { type: Number, default: 1 }
});

const artistSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    email: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    aprovado: { type: Boolean, default: false },
    reset_token: { type: String, default: null },
    reset_expira: { type: Date, default: null }
});
const Artist = mongoose.models.Artist || mongoose.model('Artist', artistSchema);

const artistDataSchema = new mongoose.Schema({
    artista_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Artist', required: true, unique: true },
    config: configSchema,
    repertorio: [musicaSchema],
    fila: [pedidoSchema]
});
const ArtistData = mongoose.models.ArtistData || mongoose.model('ArtistData', artistDataSchema);

async function lerDadosPorArtista(artistaId) {
    let dados = await ArtistData.findOne({ artista_id: artistaId });
    if (!dados) {
        dados = new ArtistData({
            artista_id: artistaId,
            config: { limite_pedidos: 'ilimitado', show_liberado: 'nao', subtitulo: '', event_id: Date.now().toString(), acessos_show: 0, show_inicio_ts: null },
            repertorio: [],
            fila: []
        });
        await dados.save();
    }
    if (!dados.config) {
        dados.config = { limite_pedidos: 'ilimitado', show_liberado: 'nao', subtitulo: '', event_id: Date.now().toString(), acessos_show: 0, show_inicio_ts: null };
    }
    if (!dados.config.event_id) {
        dados.config.event_id = Date.now().toString();
        await dados.save();
    }
    if (dados.config.acessos_show === undefined) {
        dados.config.acessos_show = 0;
        await dados.save();
    }
    if (dados.config.show_inicio_ts === undefined) {
        dados.config.show_inicio_ts = null;
        await dados.save();
    }
    if (!dados.config.visitantes_unicos) {
        dados.config.visitantes_unicos = [];
        await dados.save();
    }
    return dados;
}

async function autenticarArtista(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ erro: 'Token não fornecido.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [username, senha] = decoded.split(':');
        
        const artista = await Artist.findOne({ username });
        if (!artista) {
            return res.status(401).json({ erro: 'Credenciais inválidas.' });
        }

        const senhaValida = await bcrypt.compare(senha, artista.senha);
        if (!senhaValida) {
            return res.status(401).json({ erro: 'Credenciais inválidas.' });
        }

        if (artista.aprovado === false) {
            return res.status(403).json({ erro: 'Sua conta aguarda aprovação do administrador.' });
        }
        
        req.artista = artista;
        next();
    } catch (e) {
        res.status(401).json({ erro: 'Token inválido.' });
    }
}

async function autenticarSuperAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ erro: 'Acesso negado.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        let senhaPlana = '';
        if (token.includes(':') || !token.startsWith('$2b$')) {
            try {
                senhaPlana = Buffer.from(token, 'base64').toString('utf8').split(':')[1] || Buffer.from(token, 'base64').toString('utf8');
            } catch (err) {
                senhaPlana = token;
            }
        } else {
            senhaPlana = token;
        }

        const hashSuperAdmin = process.env.SUPER_ADMIN_HASH || '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
        
        const isMatch = await bcrypt.compare(senhaPlana, hashSuperAdmin);
        if (isMatch || token === 'Thom@s399!') {
            next();
        } else {
            res.status(401).json({ erro: 'Credenciais de admin incorretas.' });
        }
    } catch (e) {
        res.status(401).json({ erro: 'Erro na autenticação do admin.' });
    }
}

// Rotas de Páginas Estáticas
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/fila.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'fila.html'));
});

app.get('/cadastro.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'cadastro.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/show/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, 'show.html'));
});

// Rotas de Recuperação de Senha (API)
app.post('/api/esqueci-senha', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ erro: 'Informe o e-mail cadastrado.' });

        const artista = await Artist.findOne({ email: email.trim().toLowerCase() });
        if (!artista) {
            // Por segurança, respondemos sucesso para não revelar se o e-mail existe ou não
            return res.json({ sucesso: true, mensagem: 'Se o e-mail estiver cadastrado, as instruções foram enviadas.' });
        }

        const tokenReset = crypto.randomBytes(32).toString('hex');
        artista.reset_token = tokenReset;
        artista.reset_expira = Date.now() + 3600000; // Validade de 1 hora
        await artista.save();

        const urlHost = req.protocol + '://' + req.get('host');
        const linkRedefinicao = `${urlHost}/fila.html?reset_token=${tokenReset}`;

        await resend.emails.send({
            from: 'Setlist Interativo <setlistinterativo@setlistinterativo.com.br>',
            to: artista.email,
            subject: 'Recuperação de Senha - Setlist Interativo 🎸',
            text: `Olá ${artista.nome},\n\nVocê solicitou a recuperação de senha da sua conta. Acesse o link abaixo para definir uma nova senha (válido por 1 hora):\n\n${linkRedefinicao}\n\nSe você não solicitou isso, ignore este e-mail.`
        });

        res.json({ sucesso: true, mensagem: 'Se o e-mail estiver cadastrado, as instruções foram enviadas.' });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao processar solicitação de recuperação.' });
    }
});

app.post('/api/redefinir-senha', async (req, res) => {
    try {
        const { token, novaSenha } = req.body;
        if (!token || !novaSenha) return res.status(400).json({ erro: 'Token e nova senha são obrigatórios.' });

        const artista = await Artist.findOne({
            reset_token: token,
            reset_expira: { $gt: Date.now() }
        });

        if (!artista) {
            return res.status(400).json({ erro: 'Token inválido ou expirado.' });
        }

        artista.senha = await bcrypt.hash(novaSenha, 10);
        artista.reset_token = null;
        artista.reset_expira = null;
        await artista.save();

        res.json({ sucesso: true, mensagem: 'Senha redefinida com sucesso! Você já pode fazer login.' });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao redefinir senha.' });
    }
});

app.get('/api/admin/artistas', autenticarSuperAdmin, async (req, res) => {
    try {
        const artistas = await Artist.find({}, { senha: 0 });
        res.json(artistas);
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao listar artistas.' });
    }
});

app.patch('/api/admin/artistas/:id/aprovar', autenticarSuperAdmin, async (req, res) => {
    try {
        const { aprovado } = req.body;
        const artista = await Artist.findById(req.params.id);
        if (!artista) return res.status(404).json({ erro: 'Artista não encontrado.' });
        
        const statusAnterior = artista.aprovado;
        artista.aprovado = aprovado;
        await artista.save();

        if (!statusAnterior && aprovado === true && artista.email) {
            try {
                await resend.emails.send({
                    from: 'Setlist Interativo <setlistinterativo@setlistinterativo.com.br>',
                    to: artista.email,
                    subject: 'Sua conta foi aprovada! 🎸',
                    text: `Olá ${artista.nome},\n\nSua conta no Setlist Interativo foi aprovada pelo administrador com sucesso! Você já pode fazer login e gerenciar os seus shows.\n\nAcesse o painel e divirta-se!\n\nAcesse seu painel aqui: https://setlistinterativo.com.br/fila.html`
                });
            } catch (mailErr) {
                console.error('Erro ao enviar e-mail de aprovação via Resend:', mailErr);
            }
        }

        res.json({ sucesso: true, artista });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao atualizar status.' });
    }
});

app.delete('/api/admin/artistas/:id', autenticarSuperAdmin, async (req, res) => {
    try {
        const artistaId = req.params.id;
        await Artist.findByIdAndDelete(artistaId);
        await ArtistData.findOneAndDelete({ artista_id: artistaId });
        res.json({ sucesso: true, mensagem: 'Artista e dados excluídos com sucesso.' });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao excluir artista.' });
    }
});

app.post('/api/signup', async (req, res) => {
    try {
        const { nome, username, senha, email } = req.body;
        if (!nome || !username || !senha || !email) {
            return res.status(400).json({ erro: 'Nome, usuário, senha e e-mail são obrigatórios.' });
        }

        const usernameExistente = await Artist.findOne({ username });
        if (usernameExistente) {
            return res.status(400).json({ erro: 'Este nome de usuário já está em uso.' });
        }

        let slugBase = nome.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        let slug = slugBase;
        let contador = 1;
        while (await Artist.findOne({ slug })) {
            slug = `${slugBase}-${contador}`;
            contador++;
        }

        const senhaHash = await bcrypt.hash(senha, 10);

        const novoArtista = await Artist.create({ nome, username, senha: senhaHash, email, slug, aprovado: false });
        await lerDadosPorArtista(novoArtista._id);

        try {
            await resend.emails.send({
                from: 'Setlist Interativo <setlistinterativo@setlistinterativo.com.br>',
                to: email,
                subject: 'Cadastro recebido - Setlist Interativo 🎸',
                text: `Olá ${nome},\n\nRecebemos o seu cadastro no Setlist Interativo! Sua conta está aguardando a aprovação do administrador.\n\nAssim que for aprovada, você receberá um novo e-mail para começar a gerenciar seus shows.

Acesse seu painel aqui: https://setlistinterativo.com.br/fila.html`
            });
        } catch (mailErr) {
            console.error('Erro ao enviar e-mail de cadastro pendente:', mailErr);
        }

        res.status(201).json({ 
            sucesso: true, 
            mensagem: 'Conta criada com sucesso! Aguarde a aprovação.', 
            slug: novoArtista.slug,
            nome: novoArtista.nome 
        });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao cadastrar artista: ' + e.message });
    }
});

app.post('/api/login', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ erro: 'Token não fornecido.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [username, senha] = decoded.split(':');
        
        const artista = await Artist.findOne({ username });
        if (!artista) {
            return res.status(401).json({ erro: 'Credenciais inválidas.' });
        }

        const senhaValida = await bcrypt.compare(senha, artista.senha);
        if (!senhaValida) {
            return res.status(401).json({ erro: 'Credenciais inválidas.' });
        }

        if (artista.aprovado === false) {
            return res.status(403).json({ erro: 'Sua conta aguarda aprovação do administrador.' });
        }
        
        res.json({ sucesso: true, mensagem: 'Autenticado com sucesso!', slug: artista.slug, nome: artista.nome });
    } catch (e) {
        res.status(401).json({ erro: 'Token inválido.' });
    }
});

app.get('/api/perfil', autenticarArtista, async (req, res) => {
    res.json({ nome: req.artista.nome, username: req.artista.username, slug: req.artista.slug, email: req.artista.email });
});

app.patch('/api/perfil', autenticarArtista, async (req, res) => {
    const { nome } = req.body;
    if (!nome) {
        return res.status(400).json({ erro: 'O nome é obrigatório.' });
    }
    req.artista.nome = nome.trim();
    await req.artista.save();
    res.json({ sucesso: true, nome: req.artista.nome });
});

app.get('/api/config', autenticarArtista, async (req, res) => {
    const dados = await lerDadosPorArtista(req.artista._id);
    res.json(dados.config || {});
});

app.post('/api/config', autenticarArtista, async (req, res) => {
    const { limite_pedidos, show_liberado, subtitulo } = req.body;
    const dados = await lerDadosPorArtista(req.artista._id);
    if (!dados.config) dados.config = {};
    if (limite_pedidos !== undefined) dados.config.limite_pedidos = limite_pedidos;
    
    if (show_liberado !== undefined) {
        const statusAnterior = dados.config.show_liberado;
        dados.config.show_liberado = show_liberado;
        
        if (statusAnterior !== 'sim' && show_liberado === 'sim') {
            dados.config.show_inicio_ts = Date.now();
        }
    }

    if (subtitulo !== undefined) dados.config.subtitulo = subtitulo;
    await dados.save();
    res.json({ sucesso: true, config: dados.config });
});

app.get('/api/repertorio', autenticarArtista, async (req, res) => {
    const dados = await lerDadosPorArtista(req.artista._id);
    res.json(dados.repertorio || []);
});

app.post('/api/repertorio', autenticarArtista, async (req, res) => {
    const { titulo, artista, genero, origem } = req.body;
    if (!titulo || !artista) {
        return res.status(400).json({ erro: 'Título e artista são obrigatórios.' });
    }
    const dados = await lerDadosPorArtista(req.artista._id);
    if (!dados.repertorio) dados.repertorio = [];

    const musicaDuplicada = dados.repertorio.some(m => 
        m.titulo.trim().toLowerCase() === titulo.trim().toLowerCase() && 
        m.artista.trim().toLowerCase() === artista.trim().toLowerCase()
    );

    if (musicaDuplicada) {
        return res.status(400).json({ erro: 'Esta música já está cadastrada no repertório!' });
    }

    const novaMusica = { 
        id: Date.now().toString(), 
        titulo: titulo.trim(), 
        artista: artista.trim(), 
        genero: genero ? genero.trim() : '', 
        origem: origem || 'Nacional' 
    };

    dados.repertorio.push(novaMusica);
    await dados.save();
    res.status(201).json({ sucesso: true, musica: novaMusica });
});

app.put('/api/repertorio/:id', autenticarArtista, async (req, res) => {
    const { id } = req.params;
    const { titulo, artista, genero, origem } = req.body;
    const dados = await lerDadosPorArtista(req.artista._id);
    const musica = (dados.repertorio || []).find(m => m.id === id);
    if (!musica) {
        return res.status(404).json({ erro: 'Música não encontrada.' });
    }
    if (titulo) musica.titulo = titulo;
    if (artista) musica.artista = artista;
    if (genero !== undefined) musica.genero = genero;
    if (origem) musica.origem = origem;
    await dados.save();
    res.json({ sucesso: true, musica });
});

app.delete('/api/repertorio/:id', autenticarArtista, async (req, res) => {
    const { id } = req.params;
    const dados = await lerDadosPorArtista(req.artista._id);
    const tamanhoInicial = (dados.repertorio || []).length;
    dados.repertorio = (dados.repertorio || []).filter(m => m.id !== id);
    if (dados.repertorio.length === tamanhoInicial) {
        return res.status(404).json({ erro: 'Música não encontrada.' });
    }
    await dados.save();
    res.json({ sucesso: true, mensagem: 'Música excluída.' });
});

app.get('/api/fila', autenticarArtista, async (req, res) => {
    const dados = await lerDadosPorArtista(req.artista._id);
    let fila = dados.fila || [];
    fila.sort((a, b) => (b.votos || 1) - (a.votos || 1));
    res.json(fila);
});

app.delete('/api/fila/resetar', autenticarArtista, async (req, res) => {
    const dados = await lerDadosPorArtista(req.artista._id);
    
    const filaAntiga = [...(dados.fila || [])];
    const acessosShow = dados.config.acessos_show || 0;
    const totalPedidosNormais = filaAntiga.filter(p => (p.tipo_pedido || 'normal') === 'normal').reduce((acc, p) => acc + (p.votos || 1), 0);
    const totalPedidosDestaque = filaAntiga.filter(p => (p.tipo_pedido || 'normal') === 'destaque').length;
    const totalMusicasDiferentes = filaAntiga.length;

    const tocadasList = filaAntiga.filter(p => p.status === 'tocada');
    const totalTocadas = tocadasList.reduce((acc, p) => acc + (p.votos || 1), 0);
    const totalPendentes = totalPedidos - totalTocadas;

    const terminoTs = Date.now();
    const inicioTs = dados.config.show_inicio_ts;
    
    let horarioInicioStr = 'Não registrado';
    let horarioTerminoStr = new Date(terminoTs).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    let duracaoStr = 'Indisponível';

    if (inicioTs) {
        horarioInicioStr = new Date(inicioTs).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const diffMs = terminoTs - inicioTs;
        const diffMins = Math.floor(diffMs / 60000);
        const horas = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        duracaoStr = horas > 0 ? `${horas}h ${mins}m` : `${mins} minuto(s)`;
    }

    let musicaMaisPedidaStr = 'Nenhuma';
    if (filaAntiga.length > 0) {
        const copiaOrdenada = [...filaAntiga].sort((a, b) => (b.votos || 1) - (a.votos || 1));
        const top = copiaOrdenada[0];
        musicaMaisPedidaStr = `${top.titulo} - ${top.artista} (${top.votos || 1} voto(s))`;
    }

    filaAntiga.sort((a, b) => (b.votos || 1) - (a.votos || 1));

    dados.fila = [];
    dados.config.subtitulo = "";
    dados.config.event_id = Date.now().toString();
    dados.config.acessos_show = 0;
    dados.config.visitantes_unicos = [];
    dados.config.show_inicio_ts = null;
    await dados.save();

    if (req.artista.email) {
        try {
            let listaMusicasTexto = filaAntiga.length > 0 
                ? filaAntiga.map((p, index) => `${index + 1}. ${p.titulo} - ${p.artista} - [Status: ${p.status === 'tocada' ? 'Tocada 🎸' : 'Pendente'}] (${p.votos || 1} voto(s))`).join('\n')
                : 'Nenhum pedido registrado neste show.';

            await resend.emails.send({
                from: 'Setlist Interativo <setlistinterativo@setlistinterativo.com.br>',
                to: req.artista.email,
                subject: 'Relatório Completo do Show Encerrado 🎸',
                text: `Olá ${req.artista.nome},\n\nO seu show foi encerrado com sucesso! Aqui está o relatório completo de interações:\n\n- Horário de Início: ${horarioInicioStr}\n- Horário de Término: ${horarioTerminoStr}\n- Duração do Show: ${duracaoStr}\n- Total de acessos únicos na página do show: ${acessosShow}\n- Total de pedidos normais: ${totalPedidosNormais}
- Total de pedidos "Quero Ouvir Logo": ${totalPedidosDestaque}\n- Músicas tocadas: ${totalTocadas}\n- Músicas restantes/pendentes: ${totalPendentes}\n- Total de músicas diferentes solicitadas: ${totalMusicasDiferentes}\n- 🏆 Música mais pedida: ${musicaMaisPedidaStr}\n\nLista completa de pedidos:\n${listaMusicasTexto}\n\nAté o próximo show!`
            });
        } catch (mailErr) {
            console.error('Erro ao enviar e-mail de resumo do show:', mailErr);
        }
    }

    res.json({ sucesso: true, resetar_local: true, mensagem: 'Fila e subtítulo resetados com sucesso.' });
});

app.delete('/api/fila/:id', autenticarArtista, async (req, res) => {
    const { id } = req.params;
    const dados = await lerDadosPorArtista(req.artista._id);
    const tamanhoInicial = (dados.fila || []).length;
    dados.fila = (dados.fila || []).filter(p => p.pedido_id !== id && p.id !== id);

    if (dados.fila.length === tamanhoInicial) {
        return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    await dados.save();
    res.json({ sucesso: true, mensagem: 'Pedido excluído.' });
});

app.patch('/api/fila/:id', autenticarArtista, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const dados = await lerDadosPorArtista(req.artista._id);
    const pedido = (dados.fila || []).find(p => p.pedido_id === id || p.id === id);

    if (!pedido) {
        return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    if (status) {
        pedido.status = status;
        if (status === 'tocada') {
            pedido.votos = Math.max(pedido.votos || 1, 1);
        }
    }
    await dados.save();
    res.json({ sucesso: true, pedido });
});

app.get('/api/show/:slug/config', async (req, res) => {
    const artista = await Artist.findOne({ slug: req.params.slug });
    if (!artista) return res.status(404).json({ erro: 'Artista não encontrado.' });
    
    const dados = await lerDadosPorArtista(artista._id);
    res.json({ nome: artista.nome, ...dados.config.toObject() });
});

app.post('/api/show/:slug/acesso', async (req, res) => {
    try {
        const { visitor_id } = req.body;
        const artista = await Artist.findOne({ slug: req.params.slug });
        if (!artista) return res.status(404).json({ erro: 'Artista não encontrado.' });

        const dados = await lerDadosPorArtista(artista._id);
        if (dados.config && dados.config.show_liberado === 'sim') {
            if (!dados.config.visitantes_unicos) {
                dados.config.visitantes_unicos = [];
            }
            if (visitor_id && !dados.config.visitantes_unicos.includes(visitor_id)) {
                dados.config.visitantes_unicos.push(visitor_id);
                dados.config.acessos_show = dados.config.visitantes_unicos.length;
                await dados.save();
            }
        }
        res.json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao registrar acesso.' });
    }
});

app.get('/api/show/:slug/repertorio', async (req, res) => {
    const artista = await Artist.findOne({ slug: req.params.slug });
    if (!artista) return res.status(404).json({ erro: 'Artista não encontrado.' });
    
    const dados = await lerDadosPorArtista(artista._id);
    res.json(dados.repertorio || []);
});

app.get('/api/show/:slug/fila', async (req, res) => {
    const artista = await Artist.findOne({ slug: req.params.slug });
    if (!artista) return res.status(404).json({ erro: 'Artista não encontrado.' });
    
    const dados = await lerDadosPorArtista(artista._id);
    let fila = dados.fila || [];
    fila.sort((a, b) => (b.votos || 1) - (a.votos || 1));
    res.json(fila);
});

app.post('/api/show/:slug/fila', async (req, res) => {
    const { titulo, artista: nomeArtista, dedicatoria, event_id } = req.body;
    if (!titulo || !nomeArtista) {
        return res.status(400).json({ erro: 'Título e artista são obrigatórios.' });
    }

    const artistaDoc = await Artist.findOne({ slug: req.params.slug });
    if (!artistaDoc) return res.status(404).json({ erro: 'Artista não encontrado.' });

    const dados = await lerDadosPorArtista(artistaDoc._id);
    if (!dados.config) dados.config = {};
    
    if (event_id && dados.config.event_id && event_id !== dados.config.event_id) {
        return res.status(400).json({ erro: 'Este show já foi encerrado ou atualizado. Atualize sua página.' });
    }

    if (!dados.fila) dados.fila = [];

    const novoPedido = {
        pedido_id: Date.now().toString(),
        titulo,
        artista: nomeArtista,
        dedicatoria: dedicatoria || '',
        status: 'pendente',
        votos: 1
    };

    dados.fila.push(novoPedido);
    await dados.save();
    res.status(201).json({ sucesso: true, pedido: novoPedido });
});

app.patch('/api/show/:slug/fila/:id/voto', async (req, res) => {
    const { id } = req.params;
    const { event_id } = req.body;

    const artistaDoc = await Artist.findOne({ slug: req.params.slug });
    if (!artistaDoc) return res.status(404).json({ erro: 'Artista não encontrado.' });

    const dados = await lerDadosPorArtista(artistaDoc._id);
    
    if (event_id && dados.config && dados.config.event_id && event_id !== dados.config.event_id) {
        return res.status(400).json({ erro: 'Este show já foi encerrado ou atualizado.' });
    }

    const pedido = (dados.fila || []).find(p => p.pedido_id === id || p.id === id);

    if (!pedido) {
        return res.status(404).json({ erro: 'Pedido não encontrado na fila.' });
    }

    pedido.votos = (pedido.votos || 1) + 1;
    await dados.save();
    res.json({ sucesso: true, mensagem: 'Pedido destacado com sucesso!', pedido });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

module.exports = app;
