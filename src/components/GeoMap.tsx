import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { buildMapHtml } from '@/features/map/mapDocument';
import { tileConfig, tileOrigin } from '@/features/map/tileConfig';
import { colors } from '@/theme';
import type { NodeCommunicationStatus } from '@/types/records';

export type GeoMarker = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: NodeCommunicationStatus;
  label: string;
};

export type TilePhase = 'loading' | 'ok' | 'failed';

export type GeoMapHandle = {
  zoomBy: (direction: number) => void;
  fit: () => void;
  retry: () => void;
};

type GeoMapProps = {
  markers: readonly GeoMarker[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onTilePhase: (phase: TilePhase) => void;
};

type MapMessage = {
  type: 'ready' | 'tiles' | 'select' | 'clear' | 'empty';
  id?: string;
  ok?: boolean;
};

const GeoMapView = forwardRef<GeoMapHandle, GeoMapProps>(function GeoMap(
  { markers, selectedId, onSelect, onTilePhase },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const markersRef = useRef(markers);
  const selectedRef = useRef(selectedId);
  const [booting, setBooting] = useState(true);
  const html = useMemo(() => buildMapHtml(), []);
  const origin = tileOrigin(tileConfig.urlTemplate);
  const source = useMemo(() => ({ html, baseUrl: `${origin}/` }), [html, origin]);

  markersRef.current = markers;
  selectedRef.current = selectedId;

  function run(script: string) {
    if (!readyRef.current) {
      return;
    }
    webRef.current?.injectJavaScript(`${script}; true;`);
  }

  function pushMarkers(list: readonly GeoMarker[]) {
    const payload = list.map((marker) => ({
      id: marker.id,
      name: marker.name,
      label: marker.label,
      status: marker.status,
      lat: marker.latitude,
      lng: marker.longitude,
    }));
    run(`window.__map && window.__map.setMarkers(${JSON.stringify(payload)})`);
  }

  useImperativeHandle(ref, () => ({
    zoomBy: (direction) => {
      run(`window.__map && window.__map.zoomBy(${direction})`);
    },
    fit: () => {
      run('window.__map && window.__map.fit()');
    },
    retry: () => {
      onTilePhase('loading');
      run('window.__map && window.__map.retry()');
    },
  }));

  useEffect(() => {
    pushMarkers(markers);
  }, [markers]);

  useEffect(() => {
    run(`window.__map && window.__map.select(${JSON.stringify(selectedId)})`);
  }, [selectedId]);

  function onMessage(event: WebViewMessageEvent) {
    let message: MapMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as MapMessage;
    } catch {
      return;
    }

    if (message.type === 'ready') {
      readyRef.current = true;
      setBooting(false);
      pushMarkers(markersRef.current);
      run(`window.__map && window.__map.select(${JSON.stringify(selectedRef.current)})`);
      return;
    }

    if (message.type === 'tiles') {
      onTilePhase(message.ok ? 'ok' : 'failed');
      return;
    }

    if (message.type === 'select' && message.id) {
      onSelect(message.id);
      return;
    }

    if (message.type === 'clear') {
      onSelect(null);
    }
  }

  return (
    <View style={styles.fill}>
      <WebView
        ref={webRef}
        allowFileAccess={false}
        androidLayerType="hardware"
        userAgent="TadobaForestWatch/0.1 (demonstration; light tile use)"
        bounces={false}
        cacheMode="LOAD_DEFAULT"
        domStorageEnabled
        javaScriptEnabled
        onError={() => {
          setBooting(false);
          onTilePhase('failed');
        }}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={(request) =>
          request.url.startsWith('about:') || request.url.startsWith('https://')
        }
        originWhitelist={['*']}
        scrollEnabled={false}
        setBuiltInZoomControls={false}
        setSupportMultipleWindows={false}
        source={source}
        style={styles.fill}
        webviewDebuggingEnabled={false}
      />
      {booting ? (
        <View pointerEvents="none" style={styles.boot}>
          <ActivityIndicator color={colors.forest700} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {
    backgroundColor: colors.surfaceSecondary,
    flex: 1,
  },
  boot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    justifyContent: 'center',
  },
});

export const GeoMap = memo(GeoMapView);
