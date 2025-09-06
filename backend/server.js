require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;


app.get('/song/:songName', async (req, res) => {
    const songName = req.params.songName;
    const url = `https://musicbrainz.org/ws/2/recording/?query=recording:"${songName}"&fmt=json`;

    // const titleRegex = /(remix|re-edit|mix|b-side|″|12"|radio edit|karaoke)/i;

    try {
        const response = await axios.get(url);
        // Get song ID, title, artist, genre
        const songs = response.data.recordings
            .filter(song => {
                // Filter only official releases
                const official = song.releases?.some(release => release.status == "Official");
                // const altVersions = titleRegex.test(song.title);

                return official;
            })
            .sort((a, b) => {
                const dateA = new Date(a['first-release-date'] || a.date || '2100-12-31');
                const dateB = new Date(b['first-release-date'] || b.date || '2100-12-31');
                return dateA - dateB;
            })
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map(song => ({
                songID: song.id,
                title: song.title,
                artist: song["artist-credit"]?.map(artist => artist.name) || 'Unknown',
                artistID: song["artist-credit"]?.[0]?.artist?.id,
                genre: song.tags?.map(tag => tag.name) || 'Unknown',
                score: song.score
            }));
        res.json(songs);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch song' });
    }
});

app.get('/artist/:artistName', async (req, res) => {
    const artistName = req.params.artistName;
    const url = `https://musicbrainz.org/ws/2/artist/?query=artist:"${artistName}"&fmt=json`;

    try {
        const response = await axios.get(url);
        // Get artist ID, name, type (solo or group), genre
        const artists = response.data.artists
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map(artist => {
                // Filter and sort genre by descending count
                const filteredTags = (artist.tags || [])
                    .filter(tag => parseInt(tag.count) > 0)
                    .sort((a, b) => parseInt(b.count) - parseInt(a.count))
                    .slice(0, 3);

                return {
                    artistID: artist.id,
                    name: artist.name,
                    type: artist.type,
                    genre: filteredTags.map(tag => tag.name) || 'Unknown',
                }
            });
        res.json(artists);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch artist' });
    }
});

app.get('/genre/:genreName', async (req, res) => {
    const genreName = req.params.genreName.toLowerCase();
    const sparqlQuery = `
        SELECT ?mainGenre ?mainGenreLabel ?subGenre ?subGenreLabel WHERE {
        ?mainGenre wdt:P31 wd:Q188451 .  # Instance of music genre
        OPTIONAL {
            ?subGenre wdt:P279 ?mainGenre.  # Subclass of mainGenre
            ?subGenre wdt:P31 wd:Q188451.
        }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
        }
        `;
    try {
        const response = await axios.get('https://query.wikidata.org/sparql', {
            params: { query: sparqlQuery },
            headers: { 'Accept': 'application/sparql-results+json' }
        });

        const bindings = response.data.results.bindings;
        const genreMap = {};
        const cleanGenreName = (label) => label.replace(' music', '');

        bindings.forEach(row => {
            if (!row.mainGenreLabel) return;
            const mainLabel = cleanGenreName(row.mainGenreLabel.value);
            const subLabel = row.subGenreLabel ? cleanGenreName(row.subGenreLabel.value) : null;

            if (!genreMap[mainLabel]) {
                genreMap[mainLabel] = {
                    genreID: row.mainGenre.value.split('/').pop(),  //Get WikiData ID
                    name: mainLabel,
                    subGenres: []
                };
            }
            if (subLabel) {
                genreMap[mainLabel].subGenres.push({
                    genreID: row.subGenre.value.split('/').pop(),  //Get WikiData ID
                    name: subLabel
                });
            }
        });

        // Sort genres by descending number of subgenres
        const filtered = Object.values(genreMap)
            .filter(genre => genre.name.toLowerCase().includes(genreName))
            .sort((a, b) => b.subGenres.length - a.subGenres.length);
        res.json(filtered);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch genre' });
    }
});


// Recommendation API
app.get('/recommendations', async (req, res) => {
    let { song, artist, genre } = req.query;

    // Normalise to array and remove duplicates
    song = [...new Set([].concat(song || []))];
    artist = [...new Set([].concat(artist || []))];
    genre = [...new Set([].concat(genre || []).filter(item => item !== 'Unknown'))];

    let songQuery = song.map(s => `recording:"${s}"`).join(" OR ");
    let artistQuery = artist.map(s => `arid:"${s}"`).join(" OR ");
    let genreQuery = genre.map(s => `tag:"${s}"`).join(" OR ");

    // Sorting filters by type
    const queryArr = [];
    if (songQuery) queryArr.push(`(${songQuery})`);
    if (artistQuery) queryArr.push(`(${artistQuery})`);
    if (genreQuery) queryArr.push(`(${genreQuery})`);
    // song.forEach(s => queryArr.push(`recording:"${s}"`));
    // artist.forEach(a => queryArr.push(`artist:"${a}"^5`));
    // if (genre.length) {
    //     const genreQuery = genre.map(g => `"${g}"`).join('OR');
    //     queryArr.push(`tag:(${genreQuery})`);
    // }
    
    const queryString = queryArr.join(' OR ');
    const url = `https://musicbrainz.org/ws/2/recording/?query=${queryString}&fmt=json`;

    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'NextTrack/1.0 (kailiee.03@gmail.com)' }
        });
        const recordings = response.data.recordings || [];
        const token = await getSpotifyToken(clientId, clientSecret);
        const titleRegex = /\s*[\(\[].*?(?:″|B-side|remix|re-edit|mix|extended).*?[\)\]]\s*$/i;

        const recommendations = await Promise.all(recordings.filter((song) => {
            // Filter for official releases
            const official = song.releases?.some(release => release.status === "Official");

            // Filter out live events
            const isLive = song.disambiguation?.toLowerCase().includes("live");

            // Filter out interviews / "Interview" in title
            const isInterview = song.releases?.some(release => release['release-group']?.['secondary-types']?.includes("Interview"));
            const interviewInTitle = song.title.toLowerCase().includes("Interview");

            // Check if genre is in title to avoid messy data
            const altVersions = titleRegex.test(song.title);
            
            return official && !isLive && !isInterview && !interviewInTitle && !altVersions;
        })
        .map(async (recs) => {
            // Find official release to get release-group id
            const officialRelease = recs.releases?.find(release => release.status === 'Official');
            const releaseGroupId = officialRelease?.['release-group']?.id || null;
            const image = await getAlbumArt(releaseGroupId);
            
            // const externalLinks = await getExternalURLs(recs.id);
            const spotifyURL = await searchSpotifyTrack(token, recs.title, recs['artist-credit']?.[0]?.name);
            const spotifyImage = await searchSpotifyImage(token, recs.title, recs['artist-credit']?.[0]?.name);

            return {
                songID: recs.id,
                title: recs.title,
                artist: recs["artist-credit"]?.map(artist => artist.name) || 'Unknown',
                genre: recs.tags?.map(tag => tag.name) || 'Unknown',
                image: image ? image : spotifyImage,
                spotifyURL
            }
        }));
        res.json(recommendations);
    } catch (err) {
        console.error('recommendations route error:', err.message);
        res.status(500).json({ error: 'Failed to get recommendations' });
    }
});


// Get Cover Art by release group 
getAlbumArt = async (releaseGroupId) => {
    const url = `https://coverartarchive.org/release-group/${releaseGroupId}/front-small`;
    try {
        const response = await fetch(url);
        if (response.ok) {
            return url;
        } else {
            console.error(`Error fetching cover art: ${response.statusText}`);
            return null;
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to get album art' });
        return null;
    }
}

getExternalURLs = async (trackId) => {
    const url = `https://musicbrainz.org/ws/2/recording/${trackId}?inc=url-rels&fmt=json`;
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'NextTrack/1.0 (kailiee.03@gmail.com)' }
        });
        const relations = response.data.relations || [];
        const result = {
            youtube: null,
            spotify: null
        };

        for (const rel of relations) {
            const link = rel.url?.resource;
            if (!link) continue;

            if (link.includes('youtube.com')) {
                result.youtube = link;
            } else if (link.includes('spotify.com')) {
                result.spotify = link;
            }
        }
        return result;
    } catch (err) {
        console.error(`Failed to get external URLs for ${trackId}: ${err.message}`);
        return {
            youtube: null,
            spotify: null
        } 
    }
}

// Connect to Spotify Web API
getSpotifyToken = async (clientId, clientSecret) => {
    const authString = `${clientId}:${clientSecret}`;
    const authBase64 = Buffer.from(authString).toString('base64');

    const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            "Authorization": `Basic ${authBase64}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });

    const data = await res.json();
    return data.access_token;
}

// Search for track on Spotify
searchSpotifyTrack = async (accessToken, title, artist) => {
    const cleanTitle = title.replace(/\s*\(([^()]*\bversion\b[^()]*)\)\s*$/i, " - $1")
        // .replace(/\s*[\(\[].*?(?:″|B-side|remix|re-edit|mix|extended).*?[\)\]]\s*$/i, "")
        .trim();
    
    let query = `track:"${cleanTitle}" artist:"${artist}"`;
    // console.log(cleanTitle)
    let url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`;
    let res = await fetch(url, {
        headers: { "Authorization": `Bearer ${accessToken}` }
    });
    let data = await res.json();
    
    if (!data.tracks || !data.tracks.items.length) {
        query = `${cleanTitle} ${artist}`;
        url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`;
        const res = await fetch(url, {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        data = await res.json();
    }
    if (!data.tracks || !data.tracks.items.length) return null;

    const bestMatch = data.tracks.items.find(track => {
        const trackTitle = track.name.toLowerCase().replace(/\s*\(.*?\)|\s*\[.*?\]/g, "").trim();
        const artistMatch = track.artists.some(a => a.name.toLowerCase().includes(artist.toLowerCase()));
        return trackTitle.includes(cleanTitle.toLowerCase()) && artistMatch;
    }) || data.tracks.items[0];

    return bestMatch.external_urls.spotify;
    // if (data.tracks.items.length > 0) {
    //     return data.tracks.items[0].external_urls.spotify; // Spotify track link
    // } else {
    //     return null;
    // }
}

// Search for track on Spotify
searchSpotifyImage = async (accessToken, title, artist) => {
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(`${title} ${artist}`)}&type=track&limit=1`;
    const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${accessToken}` }
    });

    const data = await res.json();
    if (data.tracks.items.length > 0) {
        const images = data.tracks.items[0].album.images; // Spotify album image
        for (const image of images) {
            if (image.width == 300) {
                return image.url;
            }
        }
    } else {
        return null;
    }
}


app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});