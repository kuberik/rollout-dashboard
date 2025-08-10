<script lang="ts">
import '../app.css';
import Navbar from '../lib/Navbar.svelte';
</script>

<div class="flex min-h-screen w-full flex-col bg-white dark:bg-gray-900">
	<Navbar />
	<main class="w-full flex-1">
		<slot />
	</main>
</div>
