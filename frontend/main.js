document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('parameterForm');

    const parameterInput = document.getElementById('parameterInput');
    const parameterSelect = document.getElementById('parameterSelect');
    const suggestionDropdown = document.getElementById('suggestionDropdown');

    const filterDropdown = document.getElementById('filterDropdown');
    const resultsContainer = document.getElementById('resultsContainer');

    const historyContainer = document.getElementById('historyContainer');

    const filters = {
        song: [],
        artist: [],
        genre: []
    };
    

    // Dynamic placeholders in search bar
    parameterSelect.addEventListener('change', () => {
        let placeholders = {
            artist: "Enter artist name...",
            genre: "Enter genre...",
            song: "Enter song title..."
        };
        parameterInput.placeholder = placeholders[parameterSelect.value];
        suggestionDropdown.innerHTML = '';
        suggestionDropdown.classList.remove('show');
    });

    // Searching for parameter
    parameterInput.addEventListener('input', async () => {
        const query = parameterInput.value.trim();
        const type = parameterSelect.value;

        // Remove suggestions on change of input
        suggestionDropdown.innerHTML = '';
        suggestionDropdown.classList.remove('show');

        if (!query) return;
        suggestionDropdown.classList.add('show');
        suggestionDropdown.innerHTML = `<div class="dropdown-item text-muted">Loading...</div>`;

        try {
            const res = await fetch(`http://localhost:8000/${encodeURIComponent(type)}/${encodeURIComponent(query)}`);
            const data = await res.json();

            if (data.length === 0) return;

            switch (type) {
                case 'artist':
                    suggestionDropdown.innerHTML = data.slice(0, 10).map(artist => `
                        <button type="button" class="dropdown-item" id="${artist.artistID}">
                            ${artist.name} <small class="text-muted">(${artist.type})</small>
                        </button>
                    `).join('');
                    break;
                case 'genre':
                    suggestionDropdown.innerHTML = data.slice(0, 10).map(genre => `
                        <button type="button" class="dropdown-item" id="${genre.genreID}">
                            ${genre.name}
                        </button>
                    `).join('');
                    break;
                case 'song':
                    suggestionDropdown.innerHTML = data.slice(0, 10).map(song => `
                        <button type="button" class="dropdown-item" id="${song.songID}">
                            ${song.title} <small class="text-muted">(${song.artist.join(', ')})</small>
                        </button>
                    `).join('');
                    break;
            }

            // Add suggestion to filter when click
            [...suggestionDropdown.children].forEach(button => {
                button.addEventListener('click', () => {
                    const selectedItem = data.find(item => item[`${type}ID`] == button.id);
                    const label = button.innerText;
                    addFilterItem(button.id, label, type, selectedItem);
                    parameterInput.value = '';
                    suggestionDropdown.classList.remove('show');
                });
            });
        } catch (error) {
            suggestionDropdown.innerHTML = `<div class="dropdown-item text-danger">Error loading...</div>`;
            console.error("Fetch error:", error);
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        document.getElementById('loadingSpinner').classList.remove('d-none');
        resultsContainer.innerHTML = '';

        // Build query string
        const query = new URLSearchParams();
        filters.song.forEach(song => {
            if (song.title) query.append('song', song.title);
            if (song.artistID) query.append('artist', song.artistID);
            if (song.genre) query.append('genre', song.genre);
            // if (Array.isArray(song.artist)) {
            //     song.artist.forEach(artist => query.append('artist', artist));
            // }
            // if (Array.isArray(song.genre)) {
            //     song.genre.forEach(genre => query.append('genre', genre));
            // }
        });
        filters.artist.forEach(artist => {
            if (artist.id) query.append('artist', artist.id);
            if (artist.genre) query.append('genre', artist.genre);
        });
        filters.genre.forEach(genre => query.append('genre', genre.name));

        // Call your GET API with query parameters
        try {
            const res = await fetch(`http://localhost:8000/recommendations?${query.toString()}`);
            const recommendations = await res.json();
            document.getElementById('loadingSpinner').classList.add('d-none');

            for (let i = 0; i < recommendations.length; i++) {
                //songID, title, artist, genre
                let rec = recommendations[i];
                resultsContainer.innerHTML += `
                    <div class="col-sm-6 mb-4">
                        <div class="card">
                            <div class="row">
                                <div class="col-4 d-flex justify-content-center align-items-center">
                                    <img class="albumArt" src="${rec.image}">
                                </div>
                                <div class="col-8 card-body">
                                    <h5 class="card-title">${rec.title}</h5>
                                    <div class="card-text"><b>Artist</b>: ${rec.songID}</div>
                                    <div class="card-text"><b>Artist</b>: ${rec.artist}</div>
                                    <div class="card-text"><b>Genres</b>: ${rec.genre}</div>
                                    <div class="card-text row">
                                        ${rec.spotifyURL ? `
                                        <a href="${rec.spotifyURL}" class="col-auto spotifyLink" target="_blank"
                                        data-songid="${rec.songID}" data-title="${rec.title}" data-artist="${rec.artist}" data-image="${rec.image}">
                                            <i class="bi bi-spotify"></i>
                                        </a>
                                        ` : ''}
                                        <div class="col-auto btn-group" role="group">
                                            <button type="button" class="btn btn-outline-primary">
                                                <i class="bi bi-hand-thumbs-up" id="likeBtn"></i>
                                            </button>
                                            <button type="button" class="btn btn-outline-primary">
                                                <i class="bi bi-hand-thumbs-down" id="dislikeBtn"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        } catch (err) {
            document.getElementById('loadingSpinner').classList.add('d-none');
            resultsContainer.innerHTML += `<div class="text-danger text-center">Failed to fetch recommendations<div>`;
            console.error("Recommendation fetch failed", err);
        }
    });


    updateFilterUI = () => {
        // Toggle "No Filter" message
        document.getElementById('noFilterMessage').style.display =
            filters.artist.length == 0 && filters.genre.length == 0 && filters.song.length == 0
            ? 'block' : 'none';

        // Toggle category headers
        document.getElementById('artistFilterGroup').style.display = filters.artist.length == 0 ? 'none' : 'block';
        document.getElementById('genreFilterGroup').style.display = filters.genre.length == 0 ? 'none' : 'block';
        document.getElementById('songFilterGroup').style.display = filters.song.length == 0 ? 'none' : 'block';
    }

    // Function to add searched JSON object to filter dropdown
    addFilterItem = async (id, label, type, object) => {
        // If not duplicate, push into array
        if (filters[type].some(item => item.id === id)) return;
        filters[type].push({id, ...object});
        updateFilterUI();

        const item = document.createElement('div');
        item.className = 'd-flex justify-content-between dropdown-item';
        item.dataset.type = type;
        item.dataset.value = id;
        item.innerHTML = `
            <span>${label}</span>
            <button type="button" class="ms-2 mt-1 float-end btn-close"></button>
        `;

        const typeFilterGroup = document.getElementById(`${type}FilterGroup`)
        typeFilterGroup.appendChild(item);

        item.querySelector('.btn-close').addEventListener('click', () => {
            typeFilterGroup.removeChild(item);
            // Filter parameters that don't match current one
            filters[type] = filters[type].filter(obj => obj.id !== id);
            updateFilterUI();
        });

        filterDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    resultsContainer.addEventListener('click', (e) => {
        const link = e.target.closest('.spotifyLink');
        if (!link) return;

        const songData = {
            songID: link.dataset.songid,
            title: link.dataset.title,
            artist: link.dataset.artist,
            image: link.dataset.image,
            spotifyURL: link.href
        };
        historyContainer.innerHTML += `
            <div class="row historyItem">
                <div class="col-4 d-flex justify-content-center align-items-center">
                    <img class="albumArt" src="${songData.image}">
                </div>
                <div class="col-8">
                    <h6>${songData.title}</h6>
                    <div>${songData.artist}</div>
                </div>
            </div>`;
    })

    // document.querySelectorAll('.spotifyLink').forEach(link => 
    //     link.addEventListener('click', (e) => {
    //         e.preventDefault();
    //         const songData = {
    //             songID: link.dataset.songid,
    //             title: link.dataset.title,
    //             artist: link.dataset.artist,
    //             image: link.dataset.image,
    //             spotifyURL: link.href
    //         };

    //         historyContainer.innerHTML += `
    //             <div class="row historyItem">
    //                 <div class="col-4 d-flex justify-content-center align-items-center">
    //                     <img class="albumArt" src="${songData.image}">
    //                 </div>
    //                 <div class="col-8">
    //                     <h6>${songData.title}</h6>
    //                     <div>${songData.artist}</div>
    //                 </div>
    //             </div>`;

    //         // window.open(songData.spotifyURL, "_blank");
    //     })
    // );
});