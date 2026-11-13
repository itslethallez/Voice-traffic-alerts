import { registerRootComponent } from 'expo';

// Registers the background location TaskManager task as a side effect.
// Must happen at module scope, before the app mounts, so the OS can
// invoke it even when no component tree exists (app launched in the
// background by a location event).
import './src/background/locationTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
