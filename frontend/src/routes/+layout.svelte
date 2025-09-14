<script lang="ts">
	import '../app.css';
	import Navbar from '../lib/Navbar.svelte';
</script>

<div>
	<div class="flex h-screen flex-col bg-white dark:bg-gray-900">
		<Navbar />
		<div class="flex flex-grow flex-row justify-center overflow-hidden">
			<div class="flex flex-1 flex-col">
				<main class="flex-1 overflow-y-auto">
					<div class="relative">
						<slot />
					</div>
				</main>
			</div>
		</div>
	</div>
</div>
