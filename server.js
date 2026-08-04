const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL;

mongoose.connect(MONGO_URL)
    .then(() => console.log('Conectado ao MongoDB Atlas com sucesso!'))
    .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

const configSchema = new mongoose.Schema({
    limite_pedidos: { type: String, default: 'ilimitado' },
    show_liberado: { type: String, default: 'nao' },
    subtitulo: { type: String, default: '' },
    event_id: { type: String, default: () => Date.now().toString() }
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
    votos: { type: Number, default: 1 }
});

const artistSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    slug: { type: String, required: true, unique: true }
});
const Artist = mongoose.model('Artist', artistSchema);

const artistDataSchema = new mongoose.Schema({
    artista_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Artist', required: true, unique: true },
    config: configSchema,
    repertorio: [musicaSchema],
    fila: [pedidoSchema]
});
const ArtistData = mongoose.model('ArtistData', artistDataSchema);

async function lerDadosPorArtista(artistaId) {
    let dados = await ArtistData.findOne({ artista_id: artistaId });
    if (!dados) {
        dados = new ArtistData({
            artista_id: artistaId,
            config: { limite_pedidos: 'ilimitado', show_liberado: 'nao', subtitulo: '', event_id: Date.now().toString() },
            repertorio: [],
            fila: []
        });
        await dados.save();
    }
    if (!dados.config) {
        dados.config = { limite_pedidos: 'ilimitado', show_liberado: 'nao', subtitulo: '', event_id: Date.now().toString() };
    }
    if (!dados.config.event_id) {
        dados.config.event_id = Date.now().toString();
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
        
        const artista = await Artist.findOne({ username, senha });
        if (!artista) {
            return res.status(401).json({ erro: 'Credenciais inválidas.' });
        }
        
        req.artista = artista;
        next();
    } catch (e) {
        res.status(401).json({ erro: 'Token inválido.' });
    }
}

// Rota de Cadastro de Novos Artistas
app.post('/api/signup', async (req, res) => {
    try {
        const { nome, username, senha } = req.body;
        if (!nome || !username || !senha) {
            return res.status(400).json({ erro: 'Nome, usuário e senha são obrigatórios.' });
        }

        const usernameExistente = await Artist.findOne({ username });
        if (usernameExistente) {
            return res.status(400).json({ erro: 'Este nome de usuário já está em uso.' });
        }

        // Gera um slug amigável baseado no nome (ex: "Banda Rock" vira "banda-rock")
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

        const novoArtista = await Artist.create({ nome, username, senha, slug });
        
        // Inicializa os dados vazios do artista no banco
        await lerDadosPorArtista(novoArtista._id);

        res.status(201).json({ 
            sucesso: true, 
            mensagem: 'Artista cadastrado com sucesso!', 
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
        
        const artista = await Artist.findOne({ username, senha });
        if (!artista) {
            return res.status(401).json({ erro: 'Credenciais inválidas.' });
        }
        
        res.json({ sucesso: true, mensagem: 'Autenticado com sucesso!', slug: artista.slug, nome: artista.nome });
    } catch (e) {
        res.status(401).json({ erro: 'Token inválido.' });
    }
});

app.post('/api/setup-artistas', async (req, res) => {
    const artistasIniciais = [
        { nome: 'Artista Um', username: 'artista1', senha: '123', slug: 'artista-1' },
        { nome: 'Artista Dois', username: 'artista2', senha: '123', slug: 'artista-2' },
        { nome: 'Artista Tres', username: 'artista3', senha: '123', slug: 'artista-3' },
        { nome: 'Artista Quatro', username: 'artista4', senha: '123', slug: 'artista-4' },
        { nome: 'Artista Cinco', username: 'artista5', senha: '123', slug: 'artista-5' }
    ];

    for (let art of artistasIniciais) {
        let existe = await Artist.findOne({ username: art.username });
        if (!existe) {
            let novoArt = await Artist.create(art);
            await lerDadosPorArtista(novoArt._id);
        }
    }
    res.json({ sucesso: true, mensagem: 'Artistas de teste configurados com sucesso!' });
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
    if (show_liberado !== undefined) dados.config.show_liberado = show_liberado;
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
    dados.fila = [];
    dados.config.subtitulo = "";
    dados.config.event_id = Date.now().toString();
    await dados.save();
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
