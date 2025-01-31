const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const app = express();

// Konfigurasi CORS untuk development
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Konfigurasi multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static('public'));

// Pastikan direktori ada
['uploads', 'output'].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
});

app.post('/process-csv', upload.single('csvFile'), async (req, res) => {
    console.log('Processing started...');
    
    try {
        if (!req.file) {
            throw new Error('No file uploaded');
        }

        // Parse form data dengan tipe yang benar
        const startValue = req.body.startValue;
        const endValue = req.body.endValue;
        const splitSize = parseInt(req.body.splitSize);
        const results = [];
        
        // Baca dan parse CSV
        await new Promise((resolve, reject) => {
            fs.createReadStream(req.file.path)
                .pipe(csv({ headers: ['SN'] }))  // Definisikan header secara eksplisit
                .on('data', (data) => {
                    if (data.SN) {  // Hanya tambahkan jika SN ada
                        results.push(data.SN.trim());  // Simpan string SN langsung
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        // Filter dan sort data
        const filteredData = results
            .filter(sn => sn >= startValue && sn <= endValue)
            .sort();

        // Split menjadi chunks
        const chunks = [];
        for (let i = 0; i < filteredData.length; i += splitSize) {
            chunks.push(filteredData.slice(i, i + splitSize));
        }

        console.log(`Created ${chunks.length} chunks`);

        // Buat ZIP archive
        const archive = archiver('zip', {
            zlib: { level: 9 }  // Kompresi maksimum
        });
        
        const outputPath = path.join(__dirname, 'output', 'split_files.zip');
        const output = fs.createWriteStream(outputPath);

        // Listen untuk event finish
        await new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            
            archive.pipe(output);

            // Tambahkan setiap chunk ke archive
            chunks.forEach((chunk, index) => {
                const csvContent = ['SN', ...chunk].join('\n');  // Tambahkan header
                archive.append(csvContent, { name: `split_${index + 1}.csv` });
            });

            archive.finalize();
        });

        console.log('ZIP file created successfully');

        // Kirim file ZIP ke client
        res.download(outputPath, 'split_files.zip', (err) => {
            if (err) {
                console.error('Download error:', err);
            }
            // Cleanup files
            try {
                fs.unlinkSync(req.file.path);
                fs.unlinkSync(outputPath);
            } catch (error) {
                console.error('Cleanup error:', error);
            }
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});